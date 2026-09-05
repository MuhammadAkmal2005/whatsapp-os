/**
 * Turns one stored document into the vectors the assistant answers from.
 *
 * This is the only writer of `knowledge_chunks` on the ingestion path, and almost everything
 * difficult about it comes from one fact: embedding takes seconds and happens over a network,
 * while the document it describes can be edited at any moment by the person who owns it. So
 * the work is arranged in three parts with different rules.
 *
 *   1. **Claim, then read the source.** The claim is a conditional update, so a redelivered
 *      job cannot produce two workers embedding the same document. What is read after it is
 *      the source text and its fingerprint — the fingerprint being the version this attempt
 *      is publishing for.
 *   2. **Embed outside every transaction.** A transaction held open across a provider call
 *      pins a connection and a row lock for the length of somebody else's outage. All the
 *      network work finishes before the swap begins.
 *   3. **Swap under a row lock, and only if the fingerprint still matches.** If the owner
 *      edited the document while we were embedding, our vectors describe text that is no
 *      longer there. Publishing them would put the corrected delivery charge back to the old
 *      one — so they are discarded and a fresh attempt is queued for the newer source.
 *
 * Two consequences worth stating plainly, because they look like omissions:
 *
 * **The previous corpus keeps serving until the swap commits.** Nothing is deleted early and
 * a failure withdraws nothing. An owner whose edit fails to process still has an assistant
 * that answers from the last version that worked, and retrieval does not consult document
 * status at all.
 *
 * **Embedding usage is recorded per batch, as each batch returns, and is never rolled back.**
 * If batch nine fails, batches one to eight were still billed to us by the provider and the
 * workspace still consumed them. Metering that only counted successful documents would
 * understate cost by exactly the amount that failures cost — which is the number anyone
 * investigating a bill is looking for.
 */

import 'server-only';

import {
  KNOWLEDGE_EMBEDDING_BATCH_SIZE,
  KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT,
} from '@/config/constants';
import { estimateEmbeddingCostMicros } from '@/config/models';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { queue } from '@/server/jobs';
import { releaseJobDedupeKey } from '@/server/repositories/job.repository';
import {
  claimDocumentForIngest,
  deleteChunksForDocument,
  findKnowledgeDocumentForIngest,
  insertKnowledgeChunks,
  lockDocumentForUpdate,
  markDocumentFailed,
  markDocumentReady,
  type KnowledgeChunkInsert,
  type KnowledgeDocumentRow,
} from '@/server/repositories/knowledge.repository';
import { recordEmbeddingUsage } from '@/server/repositories/usage.repository';
import { getEmbeddingProvider } from '@/server/services/agent/embedding-provider.factory';
import {
  chunkKnowledgeSource,
  type ChunkSource,
  type KnowledgeChunkDraft,
} from '@/server/services/knowledge/chunker';
import {
  classifyIngestFailure,
  KnowledgeIngestFailure,
} from '@/server/services/knowledge/errors';
import { ingestDedupeKey } from '@/server/services/knowledge/knowledge.internal';
import type { WorkspaceScopedContext } from '@/server/tenancy/context';
import type { EmbeddingProvider } from '@/services/ai/embedding-provider.interface';
import type { IngestStatus } from '@prisma/client';

/**
 * How one attempt ended, for the handler's log line and for tests.
 *
 * `SKIPPED` and `SUPERSEDED` are both successes from the queue's point of view — there was
 * nothing to do, or what there was to do has been handed to a newer job — and they are
 * distinct because the first means the document is gone and the second means it moved.
 */
export type IngestOutcome = 'READY' | 'FAILED' | 'SUPERSEDED' | 'SKIPPED';

export type IngestKnowledgeDocumentRequest = {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly jobId: string;
  /** 1-based: the queue increments at claim time, so the first execution sees 1. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly signal?: AbortSignal;
};

/**
 * The source fields, as something the chunker will accept.
 *
 * The nullable columns are checked rather than assumed. `KnowledgeType` holds five values V1
 * does not support and the source columns are nullable because a file-backed document would
 * keep its text elsewhere, so a row that reaches here without a body is possible in the
 * schema even though nothing in V1 creates one.
 *
 * All three refusals are `CONTENT_EMPTY`. The failure-code set is closed at five and none of
 * them says "this kind of document is not supported yet" — but "there is no text here to
 * read" is literally true of every case below, it is permanent, and the sentence it puts on
 * screen tells the owner to add words and try again, which is the right advice for the only
 * one of these an owner can actually reach.
 */
function toChunkSource(row: KnowledgeDocumentRow): ChunkSource {
  if (row.type === 'TEXT') {
    if (row.content === null || row.content.length === 0) {
      throw new KnowledgeIngestFailure('CONTENT_EMPTY');
    }
    return { type: 'TEXT', content: row.content };
  }

  if (row.type === 'FAQ') {
    if (
      row.question === null ||
      row.question.length === 0 ||
      row.answer === null ||
      row.answer.length === 0
    ) {
      throw new KnowledgeIngestFailure('CONTENT_EMPTY');
    }
    return { type: 'FAQ', question: row.question, answer: row.answer };
  }

  throw new KnowledgeIngestFailure('CONTENT_EMPTY');
}

/**
 * Cuts the source into pieces, refusing the two sizes that cannot be published.
 *
 * Zero chunks from a non-empty source would mean the splitter has a bug, and inserting
 * nothing while reporting success would leave a document that says it is working and
 * retrieves nothing — so it is a failure with a visible row instead.
 *
 * The ceiling is a real limit rather than a guess at one: 400 chunks is thirteen sequential
 * provider round trips, and a document that needs more is one an owner should split into
 * several so that each piece can succeed or fail on its own.
 */
function chunkOrRefuse(source: ChunkSource): KnowledgeChunkDraft[] {
  const drafts = chunkKnowledgeSource(source);

  if (drafts.length === 0) throw new KnowledgeIngestFailure('CONTENT_EMPTY');
  if (drafts.length > KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT) {
    throw new KnowledgeIngestFailure('CONTENT_TOO_LARGE');
  }

  return drafts;
}

/**
 * Stops a cancelled worker before it spends another provider call.
 *
 * Retryable, and deliberately not the runtime's own `AbortError`: shutdown is the most
 * ordinary reason an attempt ends early, the work is untouched, and the next worker to claim
 * the row should simply do it. An `AbortError` would reach `classifyAIError`, which has no
 * reason to read cancellation as transient, and the document would be marked failed for a
 * deploy.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new KnowledgeIngestFailure('AI_UNAVAILABLE');
}

/**
 * Bills one batch, whatever the batch turned out to contain.
 *
 * Called before the response is validated, on purpose. The provider charged for the request
 * the moment it served it, so a malformed response is a cost we incurred and did not get
 * anything for — exactly the kind of spend that has to appear somewhere or nobody will ever
 * find it. Recording only usable batches would make the ledger agree with the corpus and
 * disagree with the invoice.
 *
 * A failure to write the row is logged and swallowed, following the agent runtime: the
 * vectors are already paid for and already in hand, and throwing here would discard them to
 * report a bookkeeping problem.
 */
async function recordBatchUsage(
  context: WorkspaceScopedContext,
  documentId: string,
  provider: EmbeddingProvider,
  usage: { readonly inputTokens: number; readonly estimated: boolean },
): Promise<number> {
  const costMicros = estimateEmbeddingCostMicros(provider.model, usage.inputTokens) ?? 0;

  try {
    await recordEmbeddingUsage(prisma, {
      workspaceId: context.workspaceId,
      provider: provider.name,
      model: provider.model,
      estimatedInputTokens: usage.inputTokens,
      costMicros,
      metadata: { kind: 'knowledge_ingest', documentId, estimated: usage.estimated },
    });
  } catch (error) {
    logger.error('knowledge.ingest.usage_persistence_failed', {
      workspaceId: context.workspaceId,
      documentId,
      error,
    });
  }

  return costMicros;
}

type EmbeddedDrafts = {
  readonly embeddings: number[][];
  readonly batchCount: number;
  readonly estimatedTokens: number;
  readonly costMicros: number;
};

/**
 * Embeds every chunk, in batches, one batch at a time.
 *
 * Batched because a document is dozens of short pieces and one request per piece would turn a
 * 200-chunk policy into 200 round trips. Sequential because the alternative is a workspace
 * adding four documents at once and putting a few hundred concurrent requests into a provider
 * that answers the excess with 429s — which would arrive here as a retryable failure and be
 * retried into the same wall. One batch in flight per attempt is slower and finishes.
 *
 * Two checks on every response, and they are the reason `embedMany`'s contract is worth
 * stating. A provider that returns a different number of vectors than it was given texts
 * silently mis-pairs every chunk after the gap — the return policy's vectors end up on the
 * delivery document — and a provider that returns the wrong width produces a corpus whose
 * distances to a query mean nothing. Both are `AI_FAILED`: permanent, because the next
 * attempt would send exactly the same input.
 */
async function embedDrafts(
  context: WorkspaceScopedContext,
  documentId: string,
  provider: EmbeddingProvider,
  drafts: readonly KnowledgeChunkDraft[],
  signal: AbortSignal | undefined,
): Promise<EmbeddedDrafts> {
  const embeddings: number[][] = [];
  let batchCount = 0;
  let estimatedTokens = 0;
  let costMicros = 0;

  for (let start = 0; start < drafts.length; start += KNOWLEDGE_EMBEDDING_BATCH_SIZE) {
    throwIfAborted(signal);

    const batch = drafts.slice(start, start + KNOWLEDGE_EMBEDDING_BATCH_SIZE);
    const result = await provider.embedMany(
      batch.map((draft) => draft.content),
      'document',
    );

    batchCount += 1;
    estimatedTokens += result.usage.inputTokens;
    costMicros += await recordBatchUsage(context, documentId, provider, result.usage);

    if (result.embeddings.length !== batch.length) {
      throw new KnowledgeIngestFailure('AI_FAILED');
    }

    for (const embedding of result.embeddings) {
      if (embedding.length !== provider.dimensions) {
        throw new KnowledgeIngestFailure('AI_FAILED');
      }
    }

    embeddings.push(...result.embeddings);
  }

  return { embeddings, batchCount, estimatedTokens, costMicros };
}

/**
 * Pairs each chunk with its vector by position.
 *
 * The batch loop already refuses a provider that returned the wrong count, so the checks here
 * cannot fail. They are written anyway because the alternative is a non-null assertion on an
 * indexed read, and the thing being asserted about is which text a vector belongs to. A
 * silent mis-pairing is not an exception anyone sees — it is a corpus that retrieves the
 * wrong paragraph for the rest of the document's life.
 */
function pairChunks(
  documentId: string,
  drafts: readonly KnowledgeChunkDraft[],
  embeddings: readonly number[][],
): KnowledgeChunkInsert[] {
  if (embeddings.length !== drafts.length) throw new KnowledgeIngestFailure('AI_FAILED');

  return drafts.map((draft, index) => {
    const embedding = embeddings[index];
    if (embedding === undefined) throw new KnowledgeIngestFailure('AI_FAILED');

    return {
      documentId,
      position: draft.position,
      content: draft.content,
      tokenCount: draft.tokenCount,
      embedding,
    };
  });
}

type SwapResult =
  | { readonly outcome: 'ready'; readonly chunkCount: number }
  | { readonly outcome: 'superseded'; readonly status: IngestStatus }
  | { readonly outcome: 'missing' };

/**
 * Replaces the document's chunks with the new set, or decides not to.
 *
 * Everything inside is local to Postgres, which is what makes holding a row lock across it
 * acceptable. The lock is taken first and the fingerprint compared second, in that order: a
 * comparison made before the lock could be invalidated by a write landing between the read
 * and the delete, which is precisely the race this exists to close.
 *
 * The fingerprint, not `updatedAt`, is the version marker. Claiming the document writes to it,
 * so `updatedAt` has already moved by the time an attempt starts and any value captured
 * before the claim is stale on arrival. `contentHash` changes if and only if the stored source
 * changed, which is the only question being asked.
 *
 * A transaction that only took a lock and then returned still commits, and that is fine —
 * releasing a lock is all a commit has left to do.
 */
async function swapChunks(params: {
  readonly context: WorkspaceScopedContext;
  readonly documentId: string;
  readonly publishedHash: string | null;
  readonly chunks: readonly KnowledgeChunkInsert[];
  readonly embeddingModel: string;
  readonly embeddedAt: Date;
}): Promise<SwapResult> {
  return prisma.$transaction(async (tx): Promise<SwapResult> => {
    const locked = await lockDocumentForUpdate(tx, params.context, params.documentId);
    if (locked === null) return { outcome: 'missing' };

    if (locked.contentHash !== params.publishedHash) {
      return { outcome: 'superseded', status: locked.status };
    }

    await deleteChunksForDocument(tx, params.context, params.documentId);
    await insertKnowledgeChunks(tx, params.context, params.chunks, {
      embeddingModel: params.embeddingModel,
      embeddedAt: params.embeddedAt,
    });
    await markDocumentReady(tx, params.context, params.documentId, {
      chunkCount: params.chunks.length,
      ingestedAt: params.embeddedAt,
    });

    return { outcome: 'ready', chunkCount: params.chunks.length };
  });
}

/**
 * Hands the newer source to a fresh job, and releases the key that would prevent one.
 *
 * The release is the whole difficulty of the superseded path. This job's dedupe key is the
 * key the new job needs, and it is not cleared until the queue marks this job complete —
 * which happens after the handler returns, when there is no longer anywhere to enqueue from.
 * So an enqueue attempted here without the release collides with *this* job, comes back
 * `created: false`, and the owner's edit is never processed by anything.
 *
 * Releasing while still running widens the window for a duplicate enqueue, which costs
 * nothing: claiming is conditional, so a second job that arrives for the same document finds
 * it already claimed or already `READY` and completes without work.
 */
async function requeueSuperseded(
  context: WorkspaceScopedContext,
  documentId: string,
  jobId: string,
): Promise<{ readonly id: string; readonly created: boolean }> {
  await releaseJobDedupeKey(prisma, { workspaceId: context.workspaceId, jobId });

  return queue.enqueue(
    'knowledge.ingest_document',
    { workspaceId: context.workspaceId, documentId },
    { dedupeKey: ingestDedupeKey(context.workspaceId, documentId) },
  );
}

/**
 * Decides what a thrown error means for the row and for the queue.
 *
 * The three outcomes are not symmetrical, and the asymmetry is the point:
 *
 * **Retryable with attempts left** — the row is left `PROCESSING` and the error rethrown. Not
 * marked `FAILED`, because `FAILED` is outside the claim filter: marking it would stop the
 * queue's own retry from ever picking the document up again, and the retry is the thing most
 * likely to fix it. The row saying "Processing" is also honest, since another attempt is
 * genuinely coming.
 *
 * **Retryable on the final attempt** — marked `FAILED` *and* rethrown. The mark is what the
 * owner sees and retries from; the rethrow is what lets the queue dead-letter the job instead
 * of recording a success for work that never happened.
 *
 * **Permanent** — marked `FAILED` and the job completes normally. Another attempt would read
 * the same stored text and reach the same conclusion, so re-queueing would only keep the row
 * unresolved for longer.
 */
async function handleIngestFailure(params: {
  readonly context: WorkspaceScopedContext;
  readonly documentId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly startedAt: number;
  readonly error: unknown;
}): Promise<IngestOutcome> {
  const classification = classifyIngestFailure(params.error);
  const attemptsRemain = params.attempt < params.maxAttempts;

  const detail = {
    workspaceId: params.context.workspaceId,
    documentId: params.documentId,
    jobId: params.jobId,
    attempt: params.attempt,
    maxAttempts: params.maxAttempts,
    failureCode: classification.failureCode,
    category: classification.category,
    retryable: classification.retryable,
    durationMs: Date.now() - params.startedAt,
    error: params.error,
  };

  if (classification.retryable && attemptsRemain) {
    logger.warn('knowledge.ingest.failed', { ...detail, willRetry: true });
    throw params.error;
  }

  await markDocumentFailed(prisma, params.context, params.documentId, {
    failureCode: classification.failureCode,
    errorMessage: classification.message,
  });

  logger.error('knowledge.ingest.failed', { ...detail, willRetry: false });

  if (classification.retryable) throw params.error;

  return 'FAILED';
}

/**
 * One ingestion attempt, from stored source to published corpus.
 *
 * The two early exits are not errors and must not be. A document that no longer exists was
 * deleted after its job was queued, and a document that cannot be claimed is already being
 * processed by another worker or has since been marked `READY` — in both cases the correct
 * behaviour is to complete quietly, because the queue's only other option is to retry, and
 * retrying will find exactly the same thing.
 *
 * The read happens before the claim so that a missing document is reported as missing rather
 * than as unclaimable, and so the source travels with the version marker that was true when
 * it was read.
 */
export async function ingestKnowledgeDocument(
  request: IngestKnowledgeDocumentRequest,
): Promise<IngestOutcome> {
  const context: WorkspaceScopedContext = { workspaceId: request.workspaceId };
  const { documentId, jobId, attempt, maxAttempts, signal } = request;
  const base = { workspaceId: request.workspaceId, documentId, jobId, attempt };

  const row = await findKnowledgeDocumentForIngest(prisma, context, documentId);
  if (row === null) {
    logger.info('knowledge.ingest.skipped', { ...base, reason: 'document_missing' });
    return 'SKIPPED';
  }

  const claimed = await claimDocumentForIngest(prisma, context, documentId, new Date());
  if (!claimed) {
    logger.info('knowledge.ingest.skipped', {
      ...base,
      reason: 'not_claimable',
      status: row.status,
    });
    return 'SKIPPED';
  }

  const startedAt = Date.now();
  logger.info('knowledge.ingest.started', { ...base, type: row.type, byteSize: row.byteSize });

  try {
    const drafts = chunkOrRefuse(toChunkSource(row));
    logger.info('knowledge.ingest.chunked', {
      ...base,
      chunkCount: drafts.length,
      estimatedTokens: drafts.reduce((total, draft) => total + draft.tokenCount, 0),
    });

    const provider = getEmbeddingProvider();
    const embedded = await embedDrafts(context, documentId, provider, drafts, signal);
    logger.info('knowledge.ingest.embedded', {
      ...base,
      chunkCount: drafts.length,
      batchCount: embedded.batchCount,
      model: provider.model,
      estimatedTokens: embedded.estimatedTokens,
      costMicros: embedded.costMicros,
      durationMs: Date.now() - startedAt,
    });

    const embeddedAt = new Date();
    const swap = await swapChunks({
      context,
      documentId,
      publishedHash: row.contentHash,
      chunks: pairChunks(documentId, drafts, embedded.embeddings),
      embeddingModel: provider.model,
      embeddedAt,
    });

    if (swap.outcome === 'missing') {
      logger.info('knowledge.ingest.skipped', { ...base, reason: 'document_deleted' });
      return 'SKIPPED';
    }

    if (swap.outcome === 'superseded') {
      const requeued = await requeueSuperseded(context, documentId, jobId);
      logger.info('knowledge.ingest.superseded', {
        ...base,
        status: swap.status,
        discardedChunks: drafts.length,
        nextJobId: requeued.id,
        nextJobCreated: requeued.created,
      });
      return 'SUPERSEDED';
    }

    logger.info('knowledge.ingest.completed', {
      ...base,
      chunkCount: swap.chunkCount,
      model: provider.model,
      estimatedTokens: embedded.estimatedTokens,
      costMicros: embedded.costMicros,
      durationMs: Date.now() - startedAt,
    });

    return 'READY';
  } catch (error) {
    return handleIngestFailure({
      context,
      documentId,
      jobId,
      attempt,
      maxAttempts,
      startedAt,
      error,
    });
  }
}
