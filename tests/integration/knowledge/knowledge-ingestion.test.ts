/**
 * Ingestion, against a real database and the real offline embedding provider.
 *
 * The properties under test here are the ones that only exist because embedding is slow and
 * happens over a network while the document it describes stays editable. None of them can be
 * observed from a unit test of any single function: they are about what is true of the
 * database at the moment an attempt ends.
 *
 * Four in particular are worth naming, because each one is a specific way the feature could
 * be wrong while every function in it looks correct:
 *
 *   - **Cost is recorded per batch and never withdrawn.** The provider billed us for the
 *     batches that returned before the failing one, so those tokens have to appear in the
 *     ledger even though the document ends up `FAILED`.
 *   - **A failed re-ingestion withdraws nothing.** The previous corpus is still what the
 *     assistant answers from until a new one commits.
 *   - **An edit mid-flight wins.** Vectors describing text that has since been corrected are
 *     discarded rather than published, and the newer source gets its own attempt.
 *   - **Every stored chunk carries the model that produced it.** Retrieval filters on it, so a
 *     chunk without it is invisible and a chunk with the wrong one is worse than invisible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KNOWLEDGE_EMBEDDING_BATCH_SIZE } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { queue } from '@/server/jobs';
import {
  getMockEmbeddingProvider,
  resetMockEmbeddingProvider,
} from '@/server/services/agent/embedding-provider.factory';
import { chunkKnowledgeSource } from '@/server/services/knowledge/chunker';
import { ingestKnowledgeDocument } from '@/server/services/knowledge/knowledge-ingest.service';
import {
  createKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/server/services/knowledge/knowledge.service';
import { ingestDedupeKey } from '@/server/services/knowledge/knowledge.internal';
import {
  createKnowledgeDocumentSchema,
  updateKnowledgeDocumentSchema,
} from '@/server/validation/knowledge';
import type { TenantContext } from '@/server/tenancy/context';

import { createWorkspaceFixture, resetDatabase } from '../fixtures';

/** A real policy, long enough that the splitter has something to do. */
const DELIVERY = `Delivery charges and timelines

Delivery anywhere in Pakistan is Rs. 250. Orders placed before 4pm are dispatched the same
working day. Lahore, Karachi and Islamabad usually receive parcels in 2 to 3 working days.
Smaller cities can take 4 to 5 working days depending on the courier.

Cash on delivery is available nationwide and there is no extra charge for it. You pay the
rider when the parcel reaches you, and you may open the parcel and check the stitching and
the size before you pay.

We ship with TCS and Leopards. A tracking number is sent on WhatsApp as soon as the parcel
leaves our Gulberg workshop, and you can reply to that message at any time to ask where the
parcel has reached.`;

function textInput(overrides: { title?: string; content?: string } = {}) {
  return createKnowledgeDocumentSchema.parse({
    type: 'TEXT',
    title: overrides.title ?? 'Delivery information',
    content: overrides.content ?? DELIVERY,
  });
}

/**
 * A handbook long enough to need more than one batch.
 *
 * Each section is one paragraph a little under the target size, so the splitter emits one
 * piece per section and the count is predictable without being hardcoded. Forty of them is
 * well inside the 50,000-character cap and comfortably past the batch size of 32 — which is
 * the only reason this exists: a single short policy is one piece in one batch, and no
 * assertion about batching can distinguish that from a provider called once per piece.
 */
function handbook(sections = 40): string {
  return Array.from(
    { length: sections },
    (_unused, index) =>
      `Section ${index + 1}. ${DELIVERY.replace(/\n+/g, ' ')} Reference ${index + 1}.`,
  ).join('\n\n');
}

/**
 * Drives one attempt the way the job handler does.
 *
 * `attempt` defaults to the last of three, so a retryable failure resolves to a visible
 * `FAILED` row rather than being left `PROCESSING` for a retry no test is going to run.
 */
async function ingest(
  ctx: TenantContext,
  documentId: string,
  overrides: { attempt?: number; maxAttempts?: number; jobId?: string } = {},
) {
  return ingestKnowledgeDocument({
    workspaceId: ctx.workspaceId,
    documentId,
    jobId: overrides.jobId ?? '00000000-0000-4000-8000-000000000001',
    attempt: overrides.attempt ?? 3,
    maxAttempts: overrides.maxAttempts ?? 3,
  });
}

async function chunkRowsFor(documentId: string) {
  return prisma.knowledgeChunk.findMany({
    where: { documentId },
    orderBy: { position: 'asc' },
    select: {
      content: true,
      position: true,
      tokenCount: true,
      embeddingModel: true,
      embeddingDims: true,
      embeddedAt: true,
    },
  });
}

/** The vector column is `Unsupported`, so its presence has to be read in SQL. */
async function embeddedChunkCount(documentId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM knowledge_chunks
    WHERE "documentId" = ${documentId}::uuid AND embedding IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0n);
}

describe('knowledge ingestion', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockEmbeddingProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a corpus and stamps every chunk with what produced it', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    const outcome = await ingest(ws.context, documentId);

    expect(outcome).toBe('READY');

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('READY');
    expect(document.chunkCount).toBeGreaterThan(0);
    expect(document.ingestedAt).not.toBeNull();
    // Cleared, so a row that says PROCESSING with a startedAt is genuinely in flight.
    expect(document.startedAt).toBeNull();
    expect(document.errorMessage).toBeNull();
    expect(document.failureCode).toBeNull();

    const chunks = await chunkRowsFor(documentId);
    expect(chunks).toHaveLength(document.chunkCount);
    // Dense and zero-based: retrieval reads position as an ordering, and a gap in it is a
    // paragraph that went missing between the splitter and the table.
    expect(chunks.map((chunk) => chunk.position)).toEqual(
      chunks.map((_chunk, index) => index),
    );

    const provider = getMockEmbeddingProvider();
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeGreaterThan(0);
      // Provenance is the filter retrieval uses. A chunk missing it cannot be found at all.
      expect(chunk.embeddingModel).toBe(provider.model);
      expect(chunk.embeddingDims).toBe(provider.dimensions);
      expect(chunk.embeddedAt).not.toBeNull();
    }

    expect(await embeddedChunkCount(documentId)).toBe(chunks.length);
  });

  it('embeds in batches rather than one request per piece', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(
      ws.context,
      textInput({ title: 'Full shop handbook', content: handbook() }),
    );

    const provider = getMockEmbeddingProvider();
    const embedMany = vi.spyOn(provider, 'embedMany');

    await ingest(ws.context, documentId);

    const chunks = await chunkRowsFor(documentId);
    const expectedBatches = Math.ceil(chunks.length / KNOWLEDGE_EMBEDDING_BATCH_SIZE);
    // Otherwise the comparison below is vacuous: one piece in one batch looks identical to
    // one request per piece.
    expect(chunks.length).toBeGreaterThan(KNOWLEDGE_EMBEDDING_BATCH_SIZE);

    expect(embedMany).toHaveBeenCalledTimes(expectedBatches);
    expect(embedMany.mock.calls.length).toBeLessThan(chunks.length);

    // Every piece is embedded as a document, not as a question. The two are different
    // instructions to a real asymmetric model, and getting them the wrong way round makes
    // every stored vector slightly wrong in a way nothing else would reveal.
    for (const [texts, task] of embedMany.mock.calls) {
      expect(task).toBe('document');
      expect(texts.length).toBeLessThanOrEqual(KNOWLEDGE_EMBEDDING_BATCH_SIZE);
    }

    // And the batches together cover the corpus in order.
    const submitted = embedMany.mock.calls.flatMap(([texts]) => [...texts]);
    expect(submitted).toEqual(chunks.map((chunk) => chunk.content));
  });

  it('bills a Q&A as one unit and keeps the question with its answer', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(
      ws.context,
      createKnowledgeDocumentSchema.parse({
        type: 'FAQ',
        title: 'Cash on delivery',
        question: 'Do you offer cash on delivery?',
        answer: 'Jee bilkul, cash on delivery is available across Pakistan at no extra charge.',
      }),
    );

    expect(await ingest(ws.context, documentId)).toBe('READY');

    const chunks = await chunkRowsFor(documentId);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Do you offer cash on delivery?');
    expect(chunks[0]?.content).toContain('cash on delivery is available across Pakistan');
  });

  it('records the tokens the provider was paid for, once per batch', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    await ingest(ws.context, documentId);

    const usage = await prisma.usageRecord.findMany({
      where: { workspaceId: ws.workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
    });

    const chunks = await chunkRowsFor(documentId);
    expect(usage).toHaveLength(Math.ceil(chunks.length / KNOWLEDGE_EMBEDDING_BATCH_SIZE));

    const provider = getMockEmbeddingProvider();
    for (const record of usage) {
      expect(record.provider).toBe(provider.name);
      expect(record.model).toBe(provider.model);
      expect(record.quantity).toBeGreaterThan(0);
      expect(record.metadata).toMatchObject({ kind: 'knowledge_ingest', documentId });
    }

    // Nothing on the ingestion path is a chat request, so nothing should look like one to
    // whoever reads the bill.
    expect(
      await prisma.usageRecord.count({
        where: { workspaceId: ws.workspaceId, metric: 'AI_REQUEST' },
      }),
    ).toBe(0);
  });

  it('never charges for a call it did not make', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    // Deleted after its job was queued: there is no source to embed, so there is nothing
    // to bill, and the attempt is a success with no work in it.
    await prisma.knowledgeDocument.delete({ where: { id: documentId } });

    expect(await ingest(ws.context, documentId)).toBe('SKIPPED');
    expect(
      await prisma.usageRecord.count({ where: { workspaceId: ws.workspaceId } }),
    ).toBe(0);
  });
});

describe('knowledge ingestion — a failed attempt', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockEmbeddingProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The property the brief states with nine batches, at the scale a real document reaches.
   *
   * The content cap is 50,000 characters and pieces are around 900, so a single document
   * cannot need nine batches of 32 — but the number of batches was never what mattered. What
   * matters is that a batch which returned was paid for, and that a later batch failing does
   * not un-charge it. The assertion is written against the batch count the splitter actually
   * produces so it stays true if the batch size or the target chunk size ever moves.
   */
  it('still records the batches that succeeded before the one that failed', async () => {
    const ws = await createWorkspaceFixture();
    const long = handbook();
    const { documentId } = await createKnowledgeDocument(
      ws.context,
      textInput({ title: 'Full shop handbook', content: long }),
    );

    const drafts = chunkKnowledgeSource({ type: 'TEXT', content: long });
    const batches = Math.ceil(drafts.length / KNOWLEDGE_EMBEDDING_BATCH_SIZE);
    // Otherwise the test proves nothing: there has to be a batch before the failing one.
    expect(batches).toBeGreaterThan(1);

    const provider = getMockEmbeddingProvider();
    const real = provider.embedMany.bind(provider);
    let calls = 0;
    vi.spyOn(provider, 'embedMany').mockImplementation(async (texts, task) => {
      calls += 1;
      if (calls === batches) throw new Error('embedding endpoint returned 503');
      return real(texts, task);
    });

    // Rethrown even though this is the final attempt, so the queue dead-letters the job
    // instead of recording a success. The row is marked first, which is what the owner sees.
    await expect(ingest(ws.context, documentId)).rejects.toThrow();
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('FAILED');

    const usage = await prisma.usageRecord.findMany({
      where: { workspaceId: ws.workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
    });
    // The batches that returned were billed by the provider whatever happened next, and a
    // ledger that dropped them would understate cost by exactly what failures cost.
    expect(usage).toHaveLength(batches - 1);
    expect(usage.reduce((total, record) => total + record.quantity, 0)).toBeGreaterThan(0);

    // Nothing was published: a corpus assembled from the batches that happened to arrive
    // would be a document that retrieves its first half and silently omits the rest.
    expect(await prisma.knowledgeChunk.count({ where: { documentId } })).toBe(0);
  });

  it('leaves the previous corpus serving when a re-processing fails', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    expect(await ingest(ws.context, documentId)).toBe('READY');
    const published = await chunkRowsFor(documentId);
    expect(published.length).toBeGreaterThan(0);

    await updateKnowledgeDocument(
      ws.context,
      updateKnowledgeDocumentSchema.parse({
        documentId,
        type: 'TEXT',
        title: 'Delivery information',
        content: 'Delivery is now Rs. 300 nationwide and takes 2 to 3 working days.',
      }),
    );

    const provider = getMockEmbeddingProvider();
    vi.spyOn(provider, 'embedMany').mockRejectedValue(new Error('embedding endpoint timed out'));

    await expect(ingest(ws.context, documentId)).rejects.toThrow();

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('FAILED');
    expect(document.failureCode).toBe('AI_UNAVAILABLE');
    // Written for a shop owner: no status code, no provider, no model, no stack.
    expect(document.errorMessage).toBe('We could not finish this just now. Try again in a few minutes.');
    expect(document.errorMessage).not.toMatch(/503|timed out|mock-embedding|Error/);

    // The edit is kept — it is what the owner typed — and so is the corpus from the last
    // version that worked, because retrieval does not consult document status.
    expect(document.content).toContain('Rs. 300');
    expect(document.chunkCount).toBe(published.length);
    const stillThere = await chunkRowsFor(documentId);
    expect(stillThere.map((chunk) => chunk.content)).toEqual(
      published.map((chunk) => chunk.content),
    );
  });

  it('rethrows a retryable failure while attempts remain, and does not mark the row failed', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    const provider = getMockEmbeddingProvider();
    vi.spyOn(provider, 'embedMany').mockRejectedValue(new Error('embedding endpoint timed out'));

    // Rethrown so the queue can reschedule. Marking FAILED here would put the row outside
    // the claim filter and the queue's own retry could never pick it up again.
    await expect(ingest(ws.context, documentId, { attempt: 1, maxAttempts: 3 })).rejects.toThrow();

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('PROCESSING');
    expect(document.failureCode).toBeNull();
  });

  it('rethrows on the final attempt too, so the queue can dead-letter it', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    const provider = getMockEmbeddingProvider();
    vi.spyOn(provider, 'embedMany').mockRejectedValue(new Error('embedding endpoint timed out'));

    // Both, and the pair is the point: the mark is what the owner sees and retries from,
    // the throw is what stops the queue recording a success for work that never happened.
    await expect(ingest(ws.context, documentId, { attempt: 3, maxAttempts: 3 })).rejects.toThrow();

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe('FAILED');
    expect(document.failureCode).toBe('AI_UNAVAILABLE');
  });

  it('completes without a retry when the source itself is the problem', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    // Only reachable by a direct write: validation refuses empty content on the way in.
    // The row shape is possible in the schema, though, because a file-backed document would
    // keep its text elsewhere — so ingestion has to have an answer for it.
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { content: '', status: 'PENDING' },
    });

    // Returned rather than thrown: another attempt would read the same stored text and
    // reach the same conclusion, so re-queueing would only keep the row unresolved longer.
    expect(await ingest(ws.context, documentId, { attempt: 1, maxAttempts: 3 })).toBe('FAILED');

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.failureCode).toBe('CONTENT_EMPTY');
    expect(document.errorMessage).toBe('There was nothing to save here. Add some words and try again.');
  });
});

describe('knowledge ingestion — an edit while it is being processed', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockEmbeddingProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The window that exists only because embedding is a network call.
   *
   * A worker reads the source, spends a few seconds embedding it, and comes back to publish.
   * If the owner corrected a price in those few seconds, the vectors in the worker's hand
   * describe text that no longer exists — and publishing them would put the old price back
   * into the assistant's mouth while the dashboard showed the new one. There is no way to
   * see that from the outside: the document says READY, the chunk count is right, and the
   * answer is wrong.
   */
  it('discards vectors the owner has already replaced, and gives the new text its own attempt', async () => {
    const ws = await createWorkspaceFixture();
    const { documentId } = await createKnowledgeDocument(ws.context, textInput());

    // A published corpus first, so "nothing was written" and "the wrong thing was written"
    // are distinguishable at the end.
    expect(await ingest(ws.context, documentId)).toBe('READY');
    const published = await chunkRowsFor(documentId);
    expect(published.length).toBeGreaterThan(0);
    const usageBefore = await prisma.usageRecord.count({
      where: { workspaceId: ws.workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
    });

    await updateKnowledgeDocument(
      ws.context,
      updateKnowledgeDocumentSchema.parse({
        documentId,
        type: 'TEXT',
        title: 'Delivery information',
        content: 'Delivery is Rs. 275 nationwide and orders before 4pm ship the same day.',
      }),
    );

    // The job that edit left behind, claimed the way the worker claims it: RUNNING, holding
    // the dedupe key, and carrying the id the handler hands to the service.
    const claimed = await queue.claim('worker-supersession', 5);
    const job = claimed[0];
    if (!job) throw new Error('the edit should have left one job to claim');
    expect(job.type).toBe('knowledge.ingest_document');

    const provider = getMockEmbeddingProvider();
    const real = provider.embedMany.bind(provider);
    let corrected = false;
    vi.spyOn(provider, 'embedMany').mockImplementation(async (texts, task) => {
      const result = await real(texts, task);
      // The owner corrects the price while the previous version is still in the air.
      if (!corrected) {
        corrected = true;
        await updateKnowledgeDocument(
          ws.context,
          updateKnowledgeDocumentSchema.parse({
            documentId,
            type: 'TEXT',
            title: 'Delivery information',
            content: 'Delivery is Rs. 300 nationwide and orders before 4pm ship the same day.',
          }),
        );
      }
      return result;
    });

    expect(await ingest(ws.context, documentId, { jobId: job.id })).toBe('SUPERSEDED');

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    // The newer source is untouched, and the row is waiting for its own attempt rather than
    // claiming to be ready for a version nothing ever embedded.
    expect(document.content).toContain('Rs. 300');
    expect(document.status).toBe('PENDING');
    expect(document.chunkCount).toBe(published.length);

    const stored = await chunkRowsFor(documentId);
    expect(stored.map((chunk) => chunk.content)).toEqual(published.map((chunk) => chunk.content));
    // Neither the version that was embedded and thrown away, nor the one that never was.
    expect(stored.some((chunk) => chunk.content.includes('Rs. 275'))).toBe(false);
    expect(stored.some((chunk) => chunk.content.includes('Rs. 300'))).toBe(false);

    // The provider was paid for the discarded work. Withdrawing it would make the ledger
    // disagree with the invoice every time an owner edited twice in a minute.
    expect(
      await prisma.usageRecord.count({
        where: { workspaceId: ws.workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
      }),
    ).toBeGreaterThan(usageBefore);

    // And the new text is actually queued. The edit's own enqueue could not have done this:
    // it ran while this job still held the key, so it was deduped against the very attempt
    // that turned out to be stale. Releasing the key first is what makes the successor real.
    const jobs = await prisma.job.findMany({
      where: { workspaceId: ws.workspaceId, type: 'knowledge.ingest_document' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, dedupeKey: true },
    });
    expect(jobs).toHaveLength(2);
    const stale = jobs.find((row) => row.id === job.id);
    const successor = jobs.find((row) => row.id !== job.id);
    expect(stale?.dedupeKey).toBeNull();
    expect(successor?.status).toBe('PENDING');
    expect(successor?.dedupeKey).toBe(ingestDedupeKey(ws.workspaceId, documentId));
  });
});
