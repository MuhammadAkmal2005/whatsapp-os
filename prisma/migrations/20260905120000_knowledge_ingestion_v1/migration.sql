-- Knowledge ingestion v1.
--
-- Additive: three nullable columns and two unique indexes, plus one dropped column
-- default. No column is removed, no type changes, no table is rewritten, so this is
-- safe to apply to a populated database.
--
-- The HNSW index created in `20260905000000_embedding_provenance_and_hnsw_index` is
-- untouched. It cannot be expressed in `schema.prisma`, so `prisma migrate dev` may
-- report it as drift and offer to drop it; that offer must be declined.

-- AlterTable
--
-- `startedAt` records when the current ingestion attempt claimed the row, which is
-- what tells a document genuinely being processed apart from one left in PROCESSING
-- by a worker that died.
--
-- `failureCode` is a stable machine code kept apart from `errorMessage`, because that
-- column is rendered to a shop owner and has to stay prose. Support and metrics read
-- the code; nothing parses the sentence.
--
-- `contentHash` is SHA-256 over the normalised source text. See the unique index below
-- for why it exists.
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

-- CreateIndex
--
-- The only race-free defence against the same policy being stored twice. A
-- service-layer "does this already exist?" read loses to a double-submitted form:
-- both requests read nothing, both insert, and the workspace ends up with two
-- identical documents that each consume a plan slot and both get retrieved as
-- separate evidence.
--
-- Scoped to the workspace, so two businesses may of course hold the same return
-- policy. NULLs are distinct in Postgres, so documents written before this column
-- existed do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_documents_workspaceId_contentHash_key"
  ON "knowledge_documents"("workspaceId", "contentHash");

-- CreateIndex
--
-- Positions within a document are dense and zero-based, so a duplicate means either
-- a chunker bug or a half-completed re-ingestion. Without this constraint the
-- delete-then-insert swap could leave a corpus holding two chunk 3s — one of them
-- text the owner has already replaced — and retrieval would quote the old one. With
-- it, that transaction aborts and the document is retried instead.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_documentId_position_key"
  ON "knowledge_chunks"("documentId", "position");

-- AlterTable
--
-- The default named an OpenAI model this deployment never calls, so every knowledge
-- base created without an explicit value claimed a provenance that was false. There
-- is no honest default: the only correct value is the model ingestion is about to
-- embed with, which is known at write time and nowhere else. Existing rows keep
-- whatever they hold; only the default is dropped.
ALTER TABLE "knowledge_bases" ALTER COLUMN "embeddingModel" DROP DEFAULT;
