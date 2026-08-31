-- DropIndex
DROP INDEX IF EXISTS "jobs_status_runAfter_priority_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_status_priority_runAfter_idx" ON "jobs"("status", "priority" DESC, "runAfter");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_status_completedAt_idx" ON "jobs"("status", "completedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_workspaceId_contactId_channel_status_createdAt_idx" ON "conversations"("workspaceId", "contactId", "channel", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_workspaceId_deletedAt_createdAt_idx" ON "contacts"("workspaceId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_workspaceId_deletedAt_createdAt_idx" ON "products"("workspaceId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_workspaceId_deletedAt_createdAt_idx" ON "orders"("workspaceId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_events_status_processedAt_idx" ON "webhook_events"("status", "processedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "verification_tokens_consumedAt_idx" ON "verification_tokens"("consumedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_agents_workspaceId_isDefault_idx" ON "ai_agents"("workspaceId", "isDefault");

-- Partial Unique Constraints for Integrity & Consistency
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_product_null_variant_key" ON "inventory_items"("productId") WHERE "variantId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agents_workspace_default_key" ON "ai_agents"("workspaceId") WHERE "isDefault" = true;
