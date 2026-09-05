-- Embedding provenance and the vector index retrieval depends on.
--
-- Additive only: one index on an existing column, three nullable columns, one
-- btree index. Nothing is rewritten and nothing is dropped, so it is safe to
-- apply to a populated table.

-- CreateIndex
--
-- The HNSW index is what makes `ORDER BY embedding <=> $query LIMIT n` a bounded
-- lookup instead of a scan of every vector in the table. `vector_cosine_ops`
-- matches the `<=>` operator the retrieval query uses; an index built with a
-- different operator class is simply not used by that query.
--
-- Buildable on an empty table, unlike IVFFlat, which needs existing rows to
-- cluster and would have to be rebuilt after the first real ingest.
--
-- Prisma cannot express an HNSW index in `schema.prisma` — as with the partial
-- unique indexes in `20260831130000_phase9_unit2_performance_indexes`, this line
-- is the only definition of it. `prisma migrate dev` may therefore report it as
-- drift and offer to drop it; that offer must be declined.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- AlterTable
--
-- Provenance for the vector actually stored in the row. `KnowledgeBase.embeddingModel`
-- records what the workspace's corpus is *meant* to be built with and can change
-- under a corpus that was built with something else; these columns record what was
-- really used, which is the only thing that makes "does this chunk need
-- re-embedding" answerable. Nullable because existing rows predate them.
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embeddingDims" INTEGER;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

-- CreateIndex
--
-- The lookup a re-embedding job starts with: this workspace's chunks that are not
-- on the current model.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_workspaceId_embeddingModel_idx"
  ON "knowledge_chunks"("workspaceId", "embeddingModel");
