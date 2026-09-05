/**
 * The queue path, driven through a real queue, and one bug in particular.
 *
 * A dead job keeps its dedupe key on purpose: the row stays visible in the dashboard and
 * cannot be silently re-enqueued under a person's nose. The cost of that decision is sharp.
 * `insertJob` answers the next enqueue under a held key with the existing row and
 * `created: false` — so Retry, a button whose only purpose is to queue another attempt, would
 * do nothing at all from the second terminal failure onward. Nothing would throw, nothing
 * would log, and the row would sit at "Couldn't process" for ever.
 *
 * So the assertions below are deliberately about the queue's own state rather than about the
 * ingest service: which job holds the key, which row is dead, and whether a handler ran a
 * second time and published something.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prisma } from '@/db/prisma';
import { RateLimitError } from '@/server/errors';
import { queue } from '@/server/jobs';
import { registerAllHandlers } from '@/server/jobs/handlers';
import { getHandler, resetHandlers } from '@/server/jobs/registry';
import {
  getMockEmbeddingProvider,
  resetMockEmbeddingProvider,
} from '@/server/services/agent/embedding-provider.factory';
import { ingestDedupeKey } from '@/server/services/knowledge/knowledge.internal';
import {
  createKnowledgeDocument,
  retryKnowledgeDocument,
} from '@/server/services/knowledge/knowledge.service';
import { createKnowledgeDocumentSchema } from '@/server/validation/knowledge';

import { createWorkspaceFixture, resetDatabase } from '../fixtures';

const WORKER_ID = 'test-worker-1';

/** Strict, so this doubles as an assertion about what the enqueue actually stored: a job
 *  payload that grew a third field would be a change to the worker's contract. */
const ingestPayload = z
  .object({ workspaceId: z.string().uuid(), documentId: z.string().uuid() })
  .strict();

const RETURNS = `Returns and exchanges

You may exchange any unworn item within 7 days of delivery. Keep the tags on and bring the
parcel slip. Size exchanges are free in Lahore; elsewhere the courier charge is Rs. 250.

Sale items are exchange-only, and we do not refund cash on sale purchases.`;

function textInput() {
  return createKnowledgeDocumentSchema.parse({
    type: 'TEXT',
    title: 'Returns and exchanges',
    content: RETURNS,
  });
}

/**
 * One turn of the worker's loop, without the loop.
 *
 * `createWorker().start()` polls until it is shut down, which is not something a test can
 * await. What it does per job is exactly the four calls below — claim, look up the registered
 * handler, run it with the attempt number the claim assigned, then complete or fail — so
 * driving those keeps the queue's own arithmetic (attempts, backoff, dead-lettering) inside
 * the test instead of mocked out of it.
 *
 * Returns whether the handler threw, which is the only thing a caller here needs to know.
 */
async function runOneJob(): Promise<{ readonly jobId: string; readonly threw: boolean }> {
  const claimed = await queue.claim(WORKER_ID, 1);
  const job = claimed[0];
  if (!job) throw new Error('expected an eligible job to claim');
  expect(job.type).toBe('knowledge.ingest_document');

  const handler = getHandler('knowledge.ingest_document');
  if (!handler) throw new Error('knowledge.ingest_document has no registered handler');

  try {
    await handler(ingestPayload.parse(job.payload), {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      signal: new AbortController().signal,
    });
    await queue.complete(job.id);
    return { jobId: job.id, threw: false };
  } catch (error) {
    await queue.fail(job.id, error);
    return { jobId: job.id, threw: true };
  }
}

/**
 * Backdates whatever is waiting so the next claim can see it.
 *
 * A failed job is rescheduled minutes into the future, and a test cannot wait for that. This
 * is the only thing simulated here: the attempt counter, the lock and the dead-letter
 * decision are all still the queue's.
 */
async function makeEligible(): Promise<void> {
  await prisma.job.updateMany({
    where: { status: 'PENDING' },
    data: { runAfter: new Date(Date.now() - 1_000) },
  });
}

async function jobRows() {
  return prisma.job.findMany({
    where: { type: 'knowledge.ingest_document' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, attempts: true, dedupeKey: true },
  });
}

describe('knowledge ingestion through the queue', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockEmbeddingProvider();
    // Registration is normally done once at worker boot. Resetting first keeps the file
    // re-runnable, because a second `registerAllHandlers` on a populated registry is a
    // deliberate error rather than a no-op.
    resetHandlers();
    registerAllHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHandlers();
  });

  it('publishes from a real claimed job on the first attempt', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    // Queued by the save, not by the test. If this were missing, everything below would be
    // testing a job the test itself invented.
    const queued = await jobRows();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('PENDING');
    expect(queued[0]?.dedupeKey).toBe(ingestDedupeKey(ws.workspaceId, documentId));

    expect((await runOneJob()).threw).toBe(false);

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('READY');
    expect(document.chunkCount).toBeGreaterThan(0);

    const after = await jobRows();
    expect(after[0]?.status).toBe('COMPLETED');
    // Cleared on completion, so the next save of this document queues rather than dedupes
    // against a job that has already run.
    expect(after[0]?.dedupeKey).toBeNull();
  });

  it('retries after the attempt budget is spent, and the retry actually runs', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());
    const key = ingestDedupeKey(ws.workspaceId, documentId);

    // A rate limit, because it is classified as retryable by its type rather than by what its
    // message happens to say. A bare `Error` is only retryable if the text matches the
    // classifier's list, so injecting one would make this test's whole subject — three attempts,
    // then the dead letter — hinge on a wording nobody would think to preserve.
    const provider = getMockEmbeddingProvider();
    const embedMany = vi
      .spyOn(provider, 'embedMany')
      .mockRejectedValue(new RateLimitError(30));

    // Three attempts, because that is this job type's budget. The loop is the queue's own:
    // each failure reschedules until `isExhausted` sends the row to the dead letter.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await makeEligible();
      expect((await runOneJob()).threw).toBe(true);
    }

    const spent = await jobRows();
    expect(spent).toHaveLength(1);
    const dead = spent[0];
    expect(dead?.status).toBe('DEAD');
    expect(dead?.attempts).toBe(3);
    // Still held, deliberately — this is the state the bug lived in.
    expect(dead?.dedupeKey).toBe(key);

    const failed = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('AI_UNAVAILABLE');

    // The bug itself, demonstrated rather than described: an enqueue under a key a dead row
    // is holding hands back the dead row. Anything built on "just enqueue again" is a button
    // that reports success and does nothing.
    const naive = await queue.enqueue(
      'knowledge.ingest_document',
      { workspaceId: ws.workspaceId, documentId },
      { dedupeKey: key },
    );
    expect(naive.created).toBe(false);
    expect(naive.id).toBe(dead?.id);

    // What Retry does instead: release the spent key from that exact row, then queue.
    embedMany.mockRestore();
    await retryKnowledgeDocument(ws.context, { documentId });

    const requeued = await jobRows();
    expect(requeued).toHaveLength(2);
    const stale = requeued.find((row) => row.id === dead?.id);
    const successor = requeued.find((row) => row.id !== dead?.id);
    // The dead row stays dead and stays visible; only its claim on the key is given up.
    expect(stale?.status).toBe('DEAD');
    expect(stale?.dedupeKey).toBeNull();
    expect(successor?.status).toBe('PENDING');
    expect(successor?.attempts).toBe(0);
    expect(successor?.dedupeKey).toBe(key);

    const pending = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(pending.status).toBe('PENDING');
    expect(pending.failureCode).toBeNull();
    expect(pending.errorMessage).toBeNull();

    // And the successor is a real job that a worker runs and that publishes. "Retry works"
    // is not "a row appeared in the queue".
    await makeEligible();
    const second = await runOneJob();
    expect(second.threw).toBe(false);
    expect(second.jobId).toBe(successor?.id);

    const ready = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(ready.status).toBe('READY');
    expect(ready.chunkCount).toBeGreaterThan(0);
    expect(await prisma.knowledgeChunk.count({ where: { documentId } })).toBe(ready.chunkCount);

    // The failed attempts made no embedding calls that returned, so they were never billed;
    // the attempt that worked was.
    const usage = await prisma.usageRecord.count({
      where: { workspaceId: ws.workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
    });
    expect(usage).toBeGreaterThan(0);
  });

  it('completes a job whose document was deleted while it waited', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    await prisma.knowledgeDocument.delete({ where: { id: documentId } });

    // Not a failure: there is no work and no way for a retry to find any. A job that failed
    // here would be retried three times and then sit in the dead letter for a document
    // somebody deliberately removed.
    expect((await runOneJob()).threw).toBe(false);

    const after = await jobRows();
    expect(after[0]?.status).toBe('COMPLETED');
    expect(
      await prisma.usageRecord.count({ where: { workspaceId: ws.workspaceId } }),
    ).toBe(0);
  });
});
