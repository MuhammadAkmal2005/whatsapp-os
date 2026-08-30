-- AlterTable
ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspaceId_idempotencyKey_key" ON "orders"("workspaceId", "idempotencyKey");
