/**
 * Vector retrieval against a real pgvector column.
 *
 * These run against Postgres rather than a stub because every property worth
 * asserting here is a property of the SQL: that the tenant filter is inside the
 * query and not applied afterwards, that a NULL vector is skipped, that the
 * distance operator is the one the index is built for, and that the number the
 * caller reads back is a similarity rather than a distance. A mocked `$queryRaw`
 * would assert the string we wrote, not the behaviour Postgres gives it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { KNOWLEDGE_RETRIEVAL } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { InternalError } from '@/server/errors';
import {
  insertKnowledgeChunks,
  searchKnowledgeChunks,
} from '@/server/repositories/knowledge.repository';

import { createWorkspaceFixture, resetDatabase } from '../fixtures';

const EMBEDDING_MODEL = 'mock-embedding';
const DIMENSIONS = 1536;

/**
 * A unit vector on one axis. Two of these are identical (similarity 1) or exactly
 * orthogonal (similarity 0), so the similarity floor rather than luck decides what
 * comes back.
 */
function axisVector(axis: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[axis] = 1;
  return vector;
}

/** A unit vector between two axes, giving a similarity of exactly 1/√2 ≈ 0.7071. */
function betweenAxes(first: number, second: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const component = 1 / Math.SQRT2;
  vector[first] = component;
  vector[second] = component;
  return vector;
}

async function createDocument(workspaceId: string, title = 'Shop policies') {
  const knowledgeBase = await prisma.knowledgeBase.create({
    data: { workspaceId, embeddingModel: EMBEDDING_MODEL, embeddingDims: DIMENSIONS },
  });

  return prisma.knowledgeDocument.create({
    data: {
      workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      type: 'TEXT',
      title,
      status: 'READY',
    },
  });
}

const EMBEDDED_AT = new Date('2026-09-05T10:00:00.000Z');

async function seed(
  workspaceId: string,
  documentId: string,
  chunks: ReadonlyArray<{ content: string; embedding: number[]; position?: number }>,
): Promise<number> {
  return insertKnowledgeChunks(
    prisma,
    { workspaceId },
    chunks.map((chunk, index) => ({
      documentId,
      position: chunk.position ?? index,
      content: chunk.content,
      embedding: chunk.embedding,
    })),
    { embeddingModel: EMBEDDING_MODEL, embeddedAt: EMBEDDED_AT },
  );
}

/** A chunk with no vector, which the retrieval SQL must skip. */
async function seedUnembedded(workspaceId: string, documentId: string, content: string) {
  await prisma.$executeRaw`
    INSERT INTO knowledge_chunks (id, "workspaceId", "documentId", content, position)
    VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${documentId}::uuid, ${content}, 99)
  `;
}

describe('searchKnowledgeChunks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('orders by distance and returns similarity, not distance', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await seed(workspaceId, document.id, [
      { content: 'Exact match', embedding: axisVector(0) },
      { content: 'Partial match', embedding: betweenAxes(0, 5) },
    ]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      {
        embedding: axisVector(0),
        embeddingModel: EMBEDDING_MODEL,
        topK: 10,
        similarityFloor: 0,
      },
    );

    expect(results.map((row) => row.content)).toEqual(['Exact match', 'Partial match']);
    // score = 1 - cosine distance. An identical unit vector is 1, and a vector at
    // 45° is 1/√2 — if the conversion were missing these would be 0 and 0.29.
    expect(results[0]?.score).toBeCloseTo(1, 6);
    expect(results[1]?.score).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(results[0]?.documentId).toBe(document.id);
    expect(results[0]?.chunkId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // The floor is expressed as similarity because that is the number a person can
  // reason about; the SQL has to see it as a distance ceiling.
  it('converts the similarity floor into a distance ceiling', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await seed(workspaceId, document.id, [
      { content: 'Similarity 1.0', embedding: axisVector(0) },
      { content: 'Similarity 0.7071', embedding: betweenAxes(0, 5) },
      { content: 'Similarity 0.0', embedding: axisVector(9) },
    ]);

    const query = {
      embedding: axisVector(0),
      embeddingModel: EMBEDDING_MODEL,
      topK: 10,
    };

    const permissive = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { ...query, similarityFloor: 0.5 },
    );
    const strict = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { ...query, similarityFloor: 0.9 },
    );

    expect(permissive.map((row) => row.content)).toEqual(['Similarity 1.0', 'Similarity 0.7071']);
    expect(strict.map((row) => row.content)).toEqual(['Similarity 1.0']);
  });

  it('honours topK as a database limit', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await seed(
      workspaceId,
      document.id,
      Array.from({ length: 5 }, (_, index) => ({
        content: `Chunk ${index}`,
        embedding: axisVector(0),
      })),
    );

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { embedding: axisVector(0), embeddingModel: EMBEDDING_MODEL, topK: 2, similarityFloor: 0 },
    );

    expect(results).toHaveLength(2);
  });

  // The whole reason the filter is in the SQL: LIMIT applies to what the database
  // returns, so a post-hoc filter would let another tenant's chunks eat the budget.
  it('never returns another workspace\'s chunks', async () => {
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });

    const myDocument = await createDocument(mine.workspaceId);
    const theirDocument = await createDocument(theirs.workspaceId);

    await seed(mine.workspaceId, myDocument.id, [
      { content: 'My delivery charges are Rs. 200.', embedding: axisVector(0) },
    ]);
    // Same vector, so relevance cannot be the reason it is excluded.
    await seed(theirs.workspaceId, theirDocument.id, [
      { content: 'Their delivery charges are Rs. 350.', embedding: axisVector(0) },
    ]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId: mine.workspaceId },
      { embedding: axisVector(0), embeddingModel: EMBEDDING_MODEL, topK: 10, similarityFloor: 0 },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('My delivery charges are Rs. 200.');
    expect(results.some((row) => row.content.includes('Rs. 350'))).toBe(false);
  });

  it('starves nobody: a full topK of foreign chunks does not crowd out mine', async () => {
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });

    const myDocument = await createDocument(mine.workspaceId);
    const theirDocument = await createDocument(theirs.workspaceId);

    await seed(
      theirs.workspaceId,
      theirDocument.id,
      Array.from({ length: 6 }, (_, index) => ({
        content: `Foreign chunk ${index}`,
        embedding: axisVector(0),
      })),
    );
    // Slightly further away, so with a post-hoc filter it would be ranked out.
    await seed(mine.workspaceId, myDocument.id, [
      { content: 'My only chunk', embedding: betweenAxes(0, 5) },
    ]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId: mine.workspaceId },
      { embedding: axisVector(0), embeddingModel: EMBEDDING_MODEL, topK: 6, similarityFloor: 0 },
    );

    expect(results.map((row) => row.content)).toEqual(['My only chunk']);
  });

  it('skips chunks that have no embedding yet', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await seedUnembedded(workspaceId, document.id, 'Parsed but not yet embedded');
    await seed(workspaceId, document.id, [
      { content: 'Embedded and searchable', embedding: axisVector(0) },
    ]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { embedding: axisVector(0), embeddingModel: EMBEDDING_MODEL, topK: 10, similarityFloor: 0 },
    );

    expect(results.map((row) => row.content)).toEqual(['Embedded and searchable']);
  });

  it('returns an empty array when the workspace has no knowledge at all', async () => {
    const { workspaceId } = await createWorkspaceFixture();

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { embedding: axisVector(0), embeddingModel: EMBEDDING_MODEL, topK: 6, similarityFloor: 0 },
    );

    expect(results).toEqual([]);
  });

  it('returns an empty array when everything is below the floor', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await seed(workspaceId, document.id, [
      { content: 'Completely unrelated', embedding: axisVector(9) },
    ]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      {
        embedding: axisVector(0),
        embeddingModel: EMBEDDING_MODEL,
        topK: 6,
        similarityFloor: KNOWLEDGE_RETRIEVAL.similarityFloor,
      },
    );

    expect(results).toEqual([]);
  });

  // A width mismatch means the corpus and the query were embedded by different
  // models, so no distance between them means anything. Failing here names the
  // cause; Postgres would only say the vector was the wrong size.
  it('refuses a query vector of the wrong width', async () => {
    const { workspaceId } = await createWorkspaceFixture();

    await expect(
      searchKnowledgeChunks(
        prisma,
        { workspaceId },
        {
          embedding: new Array<number>(768).fill(0.1),
          embeddingModel: EMBEDDING_MODEL,
          topK: 6,
          similarityFloor: 0,
        },
      ),
    ).rejects.toBeInstanceOf(InternalError);

    await expect(
      searchKnowledgeChunks(
        prisma,
        { workspaceId },
        {
          embedding: new Array<number>(3072).fill(0.1),
          embeddingModel: EMBEDDING_MODEL,
          topK: 6,
          similarityFloor: 0,
        },
      ),
    ).rejects.toThrow(/3072 dimensions but mock-embedding produces 1536/);
  });
});

describe('insertKnowledgeChunks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // Provenance describes the vector as stored. `KnowledgeBase.embeddingModel` says
  // what the workspace's corpus is *meant* to be built with and can be changed
  // under a corpus built with something else, which is exactly why "does this chunk
  // need re-embedding" is unanswerable without these columns.
  it('records the model, width and time of the vector it actually stored', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    const written = await seed(workspaceId, document.id, [
      { content: 'Delivery is 2-3 days in Lahore.', embedding: axisVector(0), position: 0 },
      { content: 'COD is available nationwide.', embedding: axisVector(1), position: 1 },
    ]);

    expect(written).toBe(2);

    const rows = await prisma.knowledgeChunk.findMany({
      where: { workspaceId },
      orderBy: { position: 'asc' },
      select: {
        content: true,
        position: true,
        embeddingModel: true,
        embeddingDims: true,
        embeddedAt: true,
      },
    });

    expect(rows).toEqual([
      {
        content: 'Delivery is 2-3 days in Lahore.',
        position: 0,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDims: DIMENSIONS,
        embeddedAt: EMBEDDED_AT,
      },
      {
        content: 'COD is available nationwide.',
        position: 1,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDims: DIMENSIONS,
        embeddedAt: EMBEDDED_AT,
      },
    ]);
  });

  it('stores the vector so the same text retrieves itself', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);
    const embedding = betweenAxes(3, 4);

    await seed(workspaceId, document.id, [{ content: 'Exchange within 7 days.', embedding }]);

    const results = await searchKnowledgeChunks(
      prisma,
      { workspaceId },
      { embedding, embeddingModel: EMBEDDING_MODEL, topK: 1, similarityFloor: 0.99 },
    );

    expect(results[0]?.content).toBe('Exchange within 7 days.');
    expect(results[0]?.score).toBeCloseTo(1, 6);
  });

  it('writes nothing and issues no statement for an empty batch', async () => {
    const { workspaceId } = await createWorkspaceFixture();

    const written = await insertKnowledgeChunks(
      prisma,
      { workspaceId },
      [],
      { embeddingModel: EMBEDDING_MODEL, embeddedAt: EMBEDDED_AT },
    );

    expect(written).toBe(0);
    expect(await prisma.knowledgeChunk.count({ where: { workspaceId } })).toBe(0);
  });

  it('rejects the whole batch if any vector is the wrong width', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const document = await createDocument(workspaceId);

    await expect(
      insertKnowledgeChunks(
        prisma,
        { workspaceId },
        [
          { documentId: document.id, position: 0, content: 'Good', embedding: axisVector(0) },
          {
            documentId: document.id,
            position: 1,
            content: 'Bad',
            embedding: new Array<number>(512).fill(0.2),
          },
        ],
        { embeddingModel: EMBEDDING_MODEL, embeddedAt: EMBEDDED_AT },
      ),
    ).rejects.toBeInstanceOf(InternalError);

    // Validated before the statement runs, so the good chunk is not half-written.
    expect(await prisma.knowledgeChunk.count({ where: { workspaceId } })).toBe(0);
  });

  it('scopes the write to the context, not to a caller-supplied id', async () => {
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });
    const document = await createDocument(mine.workspaceId);

    await seed(mine.workspaceId, document.id, [
      { content: 'Mine', embedding: axisVector(0) },
    ]);

    expect(await prisma.knowledgeChunk.count({ where: { workspaceId: mine.workspaceId } })).toBe(1);
    expect(await prisma.knowledgeChunk.count({ where: { workspaceId: theirs.workspaceId } })).toBe(
      0,
    );
  });
});
