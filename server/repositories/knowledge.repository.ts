/**
 * The knowledge corpus: documents an owner wrote, and the vectors they were turned into.
 *
 * Two kinds of persistence live here and they behave differently. Documents are ordinary
 * Prisma rows, scoped the way every other repository scopes: `workspaceId` in the `where`,
 * writes through `updateMany` so a mismatched scope produces a count of zero rather than
 * an edit to another tenant's row. Chunks and their vectors go through raw SQL, because
 * Prisma has no vector type — which means the tenant predicate in those statements is
 * hand-written, and is the part of this file to read twice.
 *
 * The ingestion functions come in the order one attempt uses them: find the source, claim
 * the row, lock it again once the slow work is done, swap the chunks, mark the outcome.
 * They are separate calls rather than one because the embedding step between the claim
 * and the swap is a network round trip that must not be inside a transaction, and a
 * repository cannot open one anyway — `PrismaTransaction` has no `$transaction`, so the
 * service owns the boundary and passes whichever `Db` it is holding.
 */

import 'server-only';

import { Prisma, type IngestStatus, type KnowledgeType } from '@prisma/client';

import { getEmbeddingDimensions } from '@/config/models';
import { type Db, isUniqueConstraintViolation } from '@/db/prisma';
import { InternalError } from '@/server/errors';
import type { WorkspaceScopedContext } from '@/server/tenancy/context';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  /** Cosine similarity in [0, 1], derived from the distance the query returns. */
  score: number;
}

export type KnowledgeSearchParams = {
  /** The query vector. Must be as wide as `embeddingModel` is configured to produce. */
  readonly embedding: number[];
  /** The model that produced `embedding`, used to resolve the expected width. */
  readonly embeddingModel: string;
  readonly topK: number;
  /** Minimum cosine similarity to keep, in [0, 1]. Converted to a distance ceiling. */
  readonly similarityFloor: number;
};

/**
 * The shape Postgres actually returns.
 *
 * Declared because `$queryRaw<any[]>` makes every field below a lie the compiler
 * cannot catch: rename a column in the SQL and the mapping still compiles, and the
 * agent quotes `undefined` at a customer.
 */
type ChunkMatchRow = {
  chunkId: string;
  documentId: string;
  content: string;
  distance: number;
};

/**
 * Finds the chunks in this workspace closest to a query vector.
 *
 * Two things about the SQL are load-bearing.
 *
 * First, the ordering. `ORDER BY embedding <=> $vector ... LIMIT n` is the only shape
 * pgvector's HNSW index can serve; ordering by a derived `1 - distance` similarity
 * column descending is algebraically identical and completely unindexable, so it
 * reads every vector in the table. Similarity is therefore computed in TypeScript
 * below, after the database has done the part only it can do. The operator must stay
 * `<=>` to match the index's `vector_cosine_ops` — swapping in `<->` or `<#>` silently
 * drops back to a sequential scan.
 *
 * Second, the tenant and model filters live inside the SQL, not in a `.filter()`
 * afterwards. `LIMIT` applies to what the database returns, so a post-hoc filter would
 * let rows that must not be considered consume the result budget and quietly starve the
 * ones that count — the failure would look like "the AI doesn't know things", not like a
 * leak. For the tenant filter that difference is the isolation boundary; for the model
 * filter it is correctness, because a distance between vectors from two different models
 * is a number with no meaning, and the nearest of those meaningless numbers is what the
 * agent would then quote to a customer. The width guard is in the same clause: a row
 * whose stored vector is a different arity than the query's cannot be comparable even
 * when the model name matches, which is what a half-finished dimension change looks like.
 *
 * The workspace id, the model, the width and the vector are all query parameters.
 * Nothing is interpolated into the string.
 */
export async function searchKnowledgeChunks(
  db: Db,
  context: WorkspaceScopedContext,
  params: KnowledgeSearchParams,
): Promise<RetrievedChunk[]> {
  assertVectorWidth(params.embedding, params.embeddingModel);

  // Cosine distance and cosine similarity are complements, so a similarity floor is a
  // distance ceiling. Converting here keeps callers speaking in similarity — the
  // number a person can reason about — while the query speaks in the distance the
  // index is built on.
  const maxDistance = 1 - params.similarityFloor;
  const vector = formatVector(params.embedding);

  const rows = await db.$queryRaw<ChunkMatchRow[]>`
    SELECT
      id AS "chunkId",
      "documentId",
      content,
      (embedding <=> ${vector}::vector) AS distance
    FROM knowledge_chunks
    WHERE "workspaceId" = ${context.workspaceId}::uuid
      AND embedding IS NOT NULL
      AND "embeddingModel" = ${params.embeddingModel}
      AND "embeddingDims" = ${params.embedding.length}
      AND (embedding <=> ${vector}::vector) <= ${maxDistance}
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${params.topK}
  `;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    content: row.content,
    score: 1 - row.distance,
  }));
}

export type KnowledgeChunkInsert = {
  readonly documentId: string;
  readonly position: number;
  readonly content: string;
  readonly tokenCount?: number;
  readonly embedding: number[];
};

export type EmbeddingProvenance = {
  /** The model that produced every vector in the batch. */
  readonly embeddingModel: string;
  readonly embeddedAt: Date;
};

/**
 * Persists chunks and their vectors, with provenance, in one statement.
 *
 * The provenance columns describe the vector as it is being stored — the model that
 * produced it and its actual width — and are written here rather than left to the
 * caller so that no path can insert a vector without them. `KnowledgeBase.embeddingModel`
 * is not consulted: that row says what the workspace's corpus is *meant* to be built
 * with and can be changed under a corpus that was built with something else, which is
 * exactly why "does this chunk need re-embedding" is unanswerable without these columns.
 *
 * The ingestion pipeline (chunking, parsing, the reindex job) is a separate task; this is
 * the write primitive it will call.
 */
export async function insertKnowledgeChunks(
  db: Db,
  context: WorkspaceScopedContext,
  chunks: readonly KnowledgeChunkInsert[],
  provenance: EmbeddingProvenance,
): Promise<number> {
  if (chunks.length === 0) {
    return 0;
  }

  for (const chunk of chunks) {
    assertVectorWidth(chunk.embedding, provenance.embeddingModel);
  }

  const rows = chunks.map(
    (chunk) => Prisma.sql`(
      gen_random_uuid(),
      ${context.workspaceId}::uuid,
      ${chunk.documentId}::uuid,
      ${chunk.content},
      ${chunk.position},
      ${chunk.tokenCount ?? 0},
      ${formatVector(chunk.embedding)}::vector,
      ${provenance.embeddingModel},
      ${chunk.embedding.length},
      ${provenance.embeddedAt}
    )`,
  );

  return db.$executeRaw(Prisma.sql`
    INSERT INTO knowledge_chunks (
      id, "workspaceId", "documentId", content, position, "tokenCount",
      embedding, "embeddingModel", "embeddingDims", "embeddedAt"
    )
    VALUES ${Prisma.join(rows)}
  `);
}

// ── Knowledge base ─────────────────────────────────────────────────────────

/**
 * The workspace's corpus row, created on first use.
 *
 * Every document hangs off one of these, and a workspace only ever has one — so rather
 * than making the caller check, this returns the id either way. `embeddingModel` is only
 * written at creation: the column records what the corpus is *intended* to be built with,
 * and overwriting it on every add would let a change of configuration silently relabel a
 * corpus that is still full of the previous model's vectors. What each vector actually is
 * lives on the chunk.
 *
 * The unique constraint, not this read, is what makes it single: two documents added at
 * the same moment both find nothing, both insert, and one loses. Catching that and
 * reading back is the whole race handling — `upsert` would raise the same violation and
 * leave the caller to do this anyway.
 */
export async function ensureKnowledgeBase(
  db: Db,
  context: WorkspaceScopedContext,
  embeddingModel: string,
): Promise<string> {
  const existing = await db.knowledgeBase.findUnique({
    where: { workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await db.knowledgeBase.create({
      data: { workspaceId: context.workspaceId, embeddingModel },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;

    const raced = await db.knowledgeBase.findUnique({
      where: { workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!raced) {
      throw new InternalError('Knowledge base insert conflicted but no row exists.');
    }
    return raced.id;
  }
}

// ── Documents ──────────────────────────────────────────────────────────────

/** A document with its source text, which only the ingest and edit paths need. */
export type KnowledgeDocumentRow = {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  type: KnowledgeType;
  title: string;
  content: string | null;
  question: string | null;
  answer: string | null;
  status: IngestStatus;
  errorMessage: string | null;
  failureCode: string | null;
  chunkCount: number;
  byteSize: number | null;
  contentHash: string | null;
  startedAt: Date | null;
  ingestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DOCUMENT_SELECT = {
  id: true,
  workspaceId: true,
  knowledgeBaseId: true,
  type: true,
  title: true,
  content: true,
  question: true,
  answer: true,
  status: true,
  errorMessage: true,
  failureCode: true,
  chunkCount: true,
  byteSize: true,
  contentHash: true,
  startedAt: true,
  ingestedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * What a list row is allowed to contain.
 *
 * A shop owner's return policy is theirs, and a table does not display it — so the source
 * text never leaves the database for a page that would only throw it away. Written as an
 * explicit projection rather than an omission so that adding a column to the model cannot
 * start shipping it: the compiler has no opinion about what a `findMany` returns too much
 * of. `contentHash` is left out for the same reason it is stored at all — it is an
 * internal fingerprint, and a browser has no use for one.
 */
export type KnowledgeDocumentListRow = {
  id: string;
  workspaceId: string;
  type: KnowledgeType;
  title: string;
  status: IngestStatus;
  errorMessage: string | null;
  failureCode: string | null;
  chunkCount: number;
  startedAt: Date | null;
  ingestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DOCUMENT_LIST_SELECT = {
  id: true,
  workspaceId: true,
  type: true,
  title: true,
  status: true,
  errorMessage: true,
  failureCode: true,
  chunkCount: true,
  startedAt: true,
  ingestedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type KnowledgeDocumentFilters = {
  readonly cursor?: string;
  readonly limit: number;
};

export type KnowledgeDocumentPage = {
  rows: KnowledgeDocumentListRow[];
  nextCursor: string | null;
};

/**
 * One page of documents, newest first.
 *
 * Ordered by `createdAt` with `id` as a tiebreaker, for the reason `listProducts`
 * documents: a cursor needs the sort to end in something unique or a row can appear on
 * two consecutive pages.
 */
export async function listKnowledgeDocuments(
  db: Db,
  context: WorkspaceScopedContext,
  filters: KnowledgeDocumentFilters,
): Promise<KnowledgeDocumentPage> {
  const rows = await db.knowledgeDocument.findMany({
    where: { workspaceId: context.workspaceId },
    select: DOCUMENT_LIST_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * One document with its source text.
 *
 * `findFirst` with the scope in the filter rather than `findUnique` by id: a unique read
 * would return another tenant's row and leave the caller to notice, and the caller that
 * forgets is the bug. `workspaceId` is selected so the service's post-read assertion has
 * something to compare — the third isolation layer needs the column to exist in the
 * result, and omitting it is how that layer quietly stops being written.
 */
export async function findKnowledgeDocumentById(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<KnowledgeDocumentRow | null> {
  return db.knowledgeDocument.findFirst({
    where: { id: documentId, workspaceId: context.workspaceId },
    select: DOCUMENT_SELECT,
  });
}

/**
 * The same read, named for the job that depends on it most.
 *
 * Ingestion reads three things a rendering caller does not care about: the source text it
 * is about to chunk, the `status` it must claim from, and `contentHash`, which it carries
 * across the embedding call as the version it is publishing for. A separate entry point
 * means a future change to what one attempt needs lands in one place instead of widening
 * a projection the browser also receives.
 */
export async function findKnowledgeDocumentForIngest(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<KnowledgeDocumentRow | null> {
  return findKnowledgeDocumentById(db, context, documentId);
}

export type KnowledgeDocumentWriteFields = {
  readonly title: string;
  readonly content: string | null;
  readonly question: string | null;
  readonly answer: string | null;
  /** UTF-8 size of the normalised source, so a row's storage cost is legible in SQL. */
  readonly byteSize: number;
  readonly contentHash: string;
};

/**
 * Inserts a document waiting to be processed.
 *
 * `status` is left to the model's `PENDING` default rather than passed: the only way a
 * document arrives is unprocessed, and a caller able to name a status is a caller able to
 * insert something already claiming to be `READY` with no chunks behind it.
 *
 * A duplicate `contentHash` raises a unique violation, which the service turns into a
 * `ConflictError`. That is deliberate and cannot be replaced by a read-then-insert: two
 * submissions of the same form both read nothing.
 */
export async function createKnowledgeDocument(
  db: Db,
  context: WorkspaceScopedContext,
  input: KnowledgeDocumentWriteFields & {
    readonly knowledgeBaseId: string;
    readonly type: KnowledgeType;
  },
): Promise<KnowledgeDocumentRow> {
  return db.knowledgeDocument.create({
    data: { ...input, workspaceId: context.workspaceId },
    select: DOCUMENT_SELECT,
  });
}

/**
 * Replaces a document's source and sends it back to the start of the pipeline.
 *
 * The status reset is part of the same statement as the new text, not a follow-up call.
 * A row holding version two of a policy while still saying `READY` about version one's
 * chunks is a row the UI reports as answered-from and retrieval answers from — so the two
 * facts change together or not at all.
 *
 * The previous failure is cleared for the same reason: whatever went wrong was about text
 * that is no longer here, and leaving the sentence up would have the owner reading an
 * error about a document they just fixed. `chunkCount` and `ingestedAt` are deliberately
 * left alone — the old chunks are still stored and still being served, and they stay that
 * way until the swap replaces them.
 *
 * `type` is absent from the write fields, so an edit cannot turn text into a Q&A. The
 * service refuses that explicitly; this signature makes it unexpressible.
 */
export async function updateKnowledgeDocument(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
  fields: KnowledgeDocumentWriteFields,
): Promise<number> {
  const result = await db.knowledgeDocument.updateMany({
    where: { id: documentId, workspaceId: context.workspaceId },
    data: { ...fields, status: 'PENDING', errorMessage: null, failureCode: null, startedAt: null },
  });
  return result.count;
}

/**
 * Sends a document back to the start of the pipeline without changing its text.
 *
 * What Retry means. The distinction from an edit is that nothing about the source moves,
 * so the stored hash still describes what is there — and the row keeps whatever chunks it
 * already had, which is what lets a failed re-ingestion go on being answered from its
 * last good version.
 */
export async function requeueKnowledgeDocument(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<number> {
  const result = await db.knowledgeDocument.updateMany({
    where: { id: documentId, workspaceId: context.workspaceId },
    data: { status: 'PENDING', errorMessage: null, failureCode: null, startedAt: null },
  });
  return result.count;
}

/**
 * Removes a document and, by cascade, its chunks.
 *
 * A hard delete, unlike products. A product that is taken off the list still has to exist
 * for the orders that reference it; a piece of knowledge references nothing and is
 * referenced by nothing, and "delete" here has to mean the assistant stops saying it. A
 * soft-deleted policy that retrieval still matched would be the worst possible outcome of
 * pressing Delete.
 */
export async function deleteKnowledgeDocument(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<number> {
  const result = await db.knowledgeDocument.deleteMany({
    where: { id: documentId, workspaceId: context.workspaceId },
  });
  return result.count;
}

// ── Ingestion ──────────────────────────────────────────────────────────────

/**
 * Takes ownership of a document for one ingestion attempt.
 *
 * Conditional on the current status, and the condition is the concurrency control: the
 * `updateMany` filter and the write are one statement, so of two workers holding the same
 * redelivered job exactly one gets a count of one.
 *
 * `PROCESSING` is claimable, which looks wrong and is not. A worker that dies mid-attempt
 * leaves the row saying `PROCESSING` forever, and if that state were unclaimable the only
 * repair would be manual. Retrying into it is safe because the attempt ends in a locked
 * transaction that re-checks what it is publishing over. `READY` is not claimable: there
 * is nothing to do, and doing it anyway would delete a good corpus to rebuild it
 * identically. An edit or a retry sets `PENDING` first, which is how both get in.
 */
export async function claimDocumentForIngest(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
  at: Date,
): Promise<boolean> {
  const result = await db.knowledgeDocument.updateMany({
    where: {
      id: documentId,
      workspaceId: context.workspaceId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    data: { status: 'PROCESSING', startedAt: at },
  });
  return result.count === 1;
}

/** What the swap transaction needs in order to decide whether it is still current. */
export type KnowledgeDocumentLockRow = {
  id: string;
  status: IngestStatus;
  updatedAt: Date;
  contentHash: string | null;
};

/**
 * Takes a row lock, so the swap can decide against a version that cannot move under it.
 *
 * The window this closes is real and the cost of leaving it open is the worst bug in the
 * feature: an attempt reads version one, spends several seconds embedding it, and in that
 * time the owner corrects a delivery charge. Without the lock both attempts reach the
 * swap, and whichever commits second wins — which can be the one holding the *older*
 * vectors, so the assistant goes on quoting the price the owner just fixed.
 *
 * `FOR UPDATE` therefore has to be raw SQL: Prisma has no way to express it. It only means
 * anything inside a transaction — outside one the lock is taken and released by the same
 * statement — so the service opens the transaction and passes it in. `contentHash` is what
 * the caller compares, because it changes only when the source does; the lock is what makes
 * the comparison trustworthy.
 */
export async function lockDocumentForUpdate(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<KnowledgeDocumentLockRow | null> {
  const rows = await db.$queryRaw<KnowledgeDocumentLockRow[]>`
    SELECT id, status, "updatedAt", "contentHash"
    FROM knowledge_documents
    WHERE id = ${documentId}::uuid
      AND "workspaceId" = ${context.workspaceId}::uuid
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

/** Clears a document's chunks, the first half of the swap. */
export async function deleteChunksForDocument(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
): Promise<number> {
  const result = await db.knowledgeChunk.deleteMany({
    where: { documentId, workspaceId: context.workspaceId },
  });
  return result.count;
}

/**
 * Records a finished ingestion.
 *
 * `startedAt` is cleared because there is no longer an attempt in flight, which is what
 * makes a lingering value on a `PROCESSING` row diagnostic rather than ambiguous. The
 * failure fields are cleared for the obvious reason and one less obvious one: a document
 * that succeeded on its second attempt would otherwise keep showing the sentence from its
 * first, and the owner would read a failure about knowledge that is working.
 */
export async function markDocumentReady(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
  result: { readonly chunkCount: number; readonly ingestedAt: Date },
): Promise<number> {
  const updated = await db.knowledgeDocument.updateMany({
    where: { id: documentId, workspaceId: context.workspaceId },
    data: {
      status: 'READY',
      chunkCount: result.chunkCount,
      ingestedAt: result.ingestedAt,
      errorMessage: null,
      failureCode: null,
      startedAt: null,
    },
  });
  return updated.count;
}

/**
 * Records a failed ingestion.
 *
 * `chunkCount` and `ingestedAt` are untouched, and that is the point: they describe the
 * chunks that are still in the table from the last time this document processed cleanly,
 * and those chunks are still being retrieved. A failure to build version two does not
 * withdraw version one — the owner's assistant keeps answering from the policy it already
 * knows while the row says something went wrong with the edit.
 *
 * `errorMessage` is prose written for a shop owner and `failureCode` is the stable code
 * support and metrics read. Neither is ever a provider's own words.
 */
export async function markDocumentFailed(
  db: Db,
  context: WorkspaceScopedContext,
  documentId: string,
  failure: { readonly failureCode: string; readonly errorMessage: string },
): Promise<number> {
  const updated = await db.knowledgeDocument.updateMany({
    where: { id: documentId, workspaceId: context.workspaceId },
    data: { status: 'FAILED', ...failure, startedAt: null },
  });
  return updated.count;
}

/**
 * Rejects a vector that is not the width its model produces.
 *
 * A mismatch is a configuration or code disagreement, not bad user input: it means the
 * corpus and the query were embedded by different models, so no distance between them
 * means anything. Postgres would reject it at the `::vector` cast anyway — failing here
 * names the actual cause, and on the write path it fails before a bad row exists.
 * `EMBEDDING_MODELS` is the single source of truth for the width.
 */
function assertVectorWidth(embedding: readonly number[], embeddingModel: string): void {
  const expected = getEmbeddingDimensions(embeddingModel);
  if (embedding.length !== expected) {
    throw new InternalError(
      `Embedding has ${embedding.length} dimensions but ${embeddingModel} produces ${expected}.`,
    );
  }
}

/** pgvector's text input form. Cast to `vector` in SQL, never concatenated into it. */
function formatVector(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}
