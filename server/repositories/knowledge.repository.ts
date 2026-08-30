import 'server-only';

import { type Db } from '@/db/prisma';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
}

/**
 * Searches the vector database for chunks semantically similar to the provided embedding.
 * 
 * Safety:
 * - workspaceId enforces hard tenant isolation.
 * - embedding array is cast safely using ::vector.
 * - topK limits results strictly.
 * - threshold drops irrelevant evidence.
 */
export async function searchKnowledgeChunks(
  db: Db,
  workspaceId: string,
  embedding: number[],
  topK: number,
  similarityThreshold: number
): Promise<RetrievedChunk[]> {
  const vectorStr = `[${embedding.join(',')}]`;
  
  // Using cosine distance (<=>). Similarity = 1 - distance
  const rows = await db.$queryRaw<any[]>`
    SELECT
      id as "chunkId",
      "documentId",
      content,
      1 - (embedding <=> ${vectorStr}::vector) as score
    FROM knowledge_chunks
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND 1 - (embedding <=> ${vectorStr}::vector) >= ${similarityThreshold}
    ORDER BY score DESC
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    content: r.content,
    score: r.score,
  }));
}
