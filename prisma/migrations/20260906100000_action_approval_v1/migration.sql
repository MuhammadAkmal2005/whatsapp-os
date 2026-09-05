-- Action Approval V1 Migration
--
-- Adds the `action_approvals` table, along with `ApprovalActionType`, `ApprovalStatus`,
-- and `ApprovalRequesterType` enums, plus `APPROVAL_REQUESTED` to `NotificationType`.
-- Provides durable, bounded, tenant-isolated approval tracking for sensitive mutations.
-- Deduplication is enforced at the database level with a unique constraint on (workspaceId, idempotencyKey).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('ORDER_CANCEL', 'ORDER_MODIFY', 'REFUND_REQUEST', 'ADDRESS_CHANGE', 'EXCEPTIONAL_DISCOUNT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalRequesterType" AS ENUM ('AI_AGENT', 'CUSTOMER', 'SYSTEM');

-- CreateTable
CREATE TABLE "action_approvals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID,
    "contactId" UUID,
    "actionType" "ApprovalActionType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByType" "ApprovalRequesterType" NOT NULL DEFAULT 'AI_AGENT',
    "requestedById" UUID,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "payload" JSONB,
    "reason" TEXT,
    "decisionReason" TEXT,
    "resolvedByMemberId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_approvals_workspaceId_idempotencyKey_key" ON "action_approvals"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "action_approvals_workspaceId_status_createdAt_idx" ON "action_approvals"("workspaceId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "action_approvals_workspaceId_targetEntityType_targetEntityId_idx" ON "action_approvals"("workspaceId", "targetEntityType", "targetEntityId");

-- AddForeignKey
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_resolvedByMemberId_fkey" FOREIGN KEY ("resolvedByMemberId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
