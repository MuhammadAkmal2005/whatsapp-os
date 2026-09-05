-- Customer Memory V1 Migration
--
-- Adds the `customer_memories` table, along with `MemoryCategory` and `MemorySource` enums.
-- Provides durable, bounded, tenant-isolated memory for contacts across conversations.
-- Deduplication is enforced at the database level with a unique constraint on (workspaceId, contactId, key).

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('PREFERENCE', 'PRODUCT_INTEREST', 'CUSTOMER_CONTEXT');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('EXPLICIT_STATEMENT', 'ORDER_BEHAVIOR', 'MANUAL_STAFF');

-- CreateTable
CREATE TABLE "customer_memories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "category" "MemoryCategory" NOT NULL DEFAULT 'PREFERENCE',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'EXPLICIT_STATEMENT',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_memories_workspaceId_contactId_key_key" ON "customer_memories"("workspaceId", "contactId", "key");

-- CreateIndex
CREATE INDEX "customer_memories_workspaceId_contactId_category_idx" ON "customer_memories"("workspaceId", "contactId", "category");

-- CreateIndex
CREATE INDEX "customer_memories_workspaceId_contactId_updatedAt_idx" ON "customer_memories"("workspaceId", "contactId", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "customer_memories" ADD CONSTRAINT "customer_memories_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memories" ADD CONSTRAINT "customer_memories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
