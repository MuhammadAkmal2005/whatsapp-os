import 'server-only';

import { Prisma } from '@prisma/client';

import { getEmbeddingDimensions } from '@/config/models';
import { type Db } from '@/db/prisma';
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
 * Second, the tenant filter lives inside the SQL, not in a `.filter()` afterwards.
 * `LIMIT` applies to what the database returns, so a post-hoc filter would let another
 * workspace's chunks consume the result budget and quietly starve this one — the
 * failure would look like "the AI doesn't know things", not like a leak.
 *
 * Both the workspace id and the vector are query parameters. Nothing is interpolated
 * into the string.
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
