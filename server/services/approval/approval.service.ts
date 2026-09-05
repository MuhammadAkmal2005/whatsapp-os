import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import type { TenantContext, WorkspaceActorContext } from '@/server/tenancy/context';
import { requirePermission } from '@/server/tenancy/context';
import type { Permission } from '@/server/authz/permissions';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  createApproval,
  findApprovalById,
  findApprovalByIdempotencyKey,
  listApprovals,
  countPendingApprovals,
  updateApprovalStatus,
  type ActionApprovalRow,
  type ListApprovalsOptions,
} from '@/server/repositories/approval.repository';
import {
  type CreateApprovalRequestInput,
  type ApproveApprovalInput,
  type RejectApprovalInput,
  type ApprovalActionType,
} from '@/server/validation/approval';
import { cancelOrder, updateOrder } from '@/server/services/order/order.service';
import { findOrderById as findOrderByIdRow } from '@/server/repositories/order.repository';
import type { UpdateOrderInput } from '@/server/validation/order';

/**
 * Maps an approval action type to the required authorization permission.
 * High-privilege mutations demand appropriate staff roles:
 * - ORDER_CANCEL: order:cancel (MANAGER, ADMIN, OWNER)
 * - ORDER_MODIFY / ADDRESS_CHANGE: order:update (MANAGER, ADMIN, OWNER)
 * - REFUND_REQUEST: order:refund (ADMIN, OWNER)
 * - EXCEPTIONAL_DISCOUNT: order:update (MANAGER, ADMIN, OWNER)
 */
export function getRequiredPermissionForAction(actionType: ApprovalActionType): Permission {
  switch (actionType) {
    case 'ORDER_CANCEL':
      return 'order:cancel';
    case 'ORDER_MODIFY':
    case 'ADDRESS_CHANGE':
    case 'EXCEPTIONAL_DISCOUNT':
      return 'order:update';
    case 'REFUND_REQUEST':
      return 'order:refund';
    default:
      return 'order:update';
  }
}

/**
 * Creates a new ActionApproval request.
 * Idempotent: if an approval with the same idempotencyKey exists in the workspace,
 * returns the existing record immediately.
 */
export async function createApprovalRequest(
  ctx: TenantContext | WorkspaceActorContext | { workspaceId: string; membershipId?: string | null; role?: string },
  input: CreateApprovalRequestInput,
): Promise<ActionApprovalRow> {
  const db = prisma;

  // 1. Idempotency check
  if (input.idempotencyKey) {
    const existing = await findApprovalByIdempotencyKey(
      db,
      ctx.workspaceId,
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }
  }

  // 2. Create approval record
  const approval = await createApproval(db, ctx.workspaceId, {
    actionType: input.actionType,
    conversationId: input.conversationId ?? null,
    contactId: input.contactId ?? null,
    requestedByType: input.requestedByType ?? 'AI_AGENT',
    requestedById: input.requestedById ?? (ctx.role === 'AGENT' ? null : ctx.membershipId),
    targetEntityType: input.targetEntityType ?? null,
    targetEntityId: input.targetEntityId ?? null,
    payload: input.payload as any,
    reason: input.reason ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  // 3. Notify workspace staff
  await db.notification.create({
    data: {
      workspaceId: ctx.workspaceId,
      type: 'APPROVAL_REQUESTED',
      level: 'WARNING',
      title: 'Action Approval Required',
      body: `New approval requested for ${input.actionType.replace(/_/g, ' ')}${
        input.reason ? `: ${input.reason}` : '.'
      }`,
      resourceType: 'ActionApproval',
      resourceId: approval.id,
    },
  });

  // 4. Audit log
  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorType: input.requestedByType === 'AI_AGENT' ? 'AI_AGENT' : 'USER',
    actorUserId: 'user' in ctx ? ctx.user.id : undefined,
    actorMemberId: ctx.membershipId ?? undefined,
    action: 'APPROVAL_REQUESTED',
    resourceType: 'ActionApproval',
    resourceId: approval.id,
    metadata: {
      actionType: input.actionType,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      reason: input.reason,
    },
  });

  return approval;
}

/**
 * Gets a single approval request scoped to the tenant.
 */
export async function getApprovalRequest(
  ctx: TenantContext | WorkspaceActorContext,
  id: string,
): Promise<ActionApprovalRow> {
  const approval = await findApprovalById(prisma, ctx.workspaceId, id);
  if (!approval) {
    throw new NotFoundError('Approval request not found');
  }
  return approval;
}

/**
 * Lists pending approvals for the current workspace.
 */
export async function listPendingApprovals(
  ctx: TenantContext,
  options: ListApprovalsOptions = {},
): Promise<ActionApprovalRow[]> {
  return listApprovals(prisma, ctx.workspaceId, {
    ...options,
    status: options.status ?? 'PENDING',
  });
}

/**
 * Gets count of pending approvals for the workspace.
 */
export async function getPendingApprovalsCount(
  ctx: TenantContext,
): Promise<number> {
  return countPendingApprovals(prisma, ctx.workspaceId);
}

/**
 * Approves a pending request and executes the authorized domain action.
 * Enforces:
 * - Human member caller (membershipId required)
 * - Required RBAC permission for the action type
 * - Atomic state transition
 * - Idempotency on double-clicks
 * - Stale-state revalidation
 */
export async function approveRequest(
  ctx: TenantContext,
  id: string,
  input: ApproveApprovalInput = {},
): Promise<ActionApprovalRow> {
  // Must be a human member
  if (!ctx.membershipId) {
    throw new ForbiddenError('Only human team members can approve actions');
  }

  const db = prisma;

  // Load approval
  const approval = await findApprovalById(db, ctx.workspaceId, id);
  if (!approval) {
    throw new NotFoundError('Approval request not found');
  }

  // Idempotency: If already APPROVED or EXECUTED, return existing result
  if (approval.status === 'APPROVED' || approval.status === 'EXECUTED') {
    return approval;
  }

  // Cannot approve from terminal REJECTED or FAILED
  if (approval.status !== 'PENDING') {
    throw new Error(`Cannot approve an approval request in status: ${approval.status}`);
  }

  // Permission authorization
  const requiredPermission = getRequiredPermissionForAction(approval.actionType);
  requirePermission(ctx, requiredPermission);

  // Mark APPROVED
  const approved = await updateApprovalStatus(db, ctx.workspaceId, id, {
    status: 'APPROVED',
    decisionReason: input.decisionReason ?? null,
    resolvedByMemberId: ctx.membershipId,
    resolvedAt: new Date(),
  });

  // Audit approval decision
  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorType: 'USER',
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    action: 'APPROVAL_APPROVED',
    resourceType: 'ActionApproval',
    resourceId: id,
    metadata: {
      actionType: approval.actionType,
      decisionReason: input.decisionReason,
    },
  });

  // Execute the approved action
  return executeApprovedRequest(ctx, approved);
}

/**
 * Rejects a pending request.
 */
export async function rejectRequest(
  ctx: TenantContext,
  id: string,
  input: RejectApprovalInput,
): Promise<ActionApprovalRow> {
  if (!ctx.membershipId) {
    throw new ForbiddenError('Only human team members can reject actions');
  }

  const db = prisma;

  const approval = await findApprovalById(db, ctx.workspaceId, id);
  if (!approval) {
    throw new NotFoundError('Approval request not found');
  }

  // Idempotency: If already REJECTED, return existing
  if (approval.status === 'REJECTED') {
    return approval;
  }

  if (approval.status !== 'PENDING') {
    throw new Error(`Cannot reject an approval request in status: ${approval.status}`);
  }

  // Authorization check
  const requiredPermission = getRequiredPermissionForAction(approval.actionType);
  requirePermission(ctx, requiredPermission);

  const rejected = await updateApprovalStatus(db, ctx.workspaceId, id, {
    status: 'REJECTED',
    decisionReason: input.decisionReason,
    resolvedByMemberId: ctx.membershipId,
    resolvedAt: new Date(),
  });

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorType: 'USER',
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    action: 'APPROVAL_REJECTED',
    resourceType: 'ActionApproval',
    resourceId: id,
    metadata: {
      actionType: approval.actionType,
      decisionReason: input.decisionReason,
    },
  });

  return rejected;
}

/**
 * Executes an approved action.
 * Revalidates domain state before executing mutations to prevent stale executions.
 */
export async function executeApprovedRequest(
  ctx: TenantContext,
  idOrApproval: string | ActionApprovalRow,
): Promise<ActionApprovalRow> {
  const db = prisma;

  const approval =
    typeof idOrApproval === 'string'
      ? await findApprovalById(db, ctx.workspaceId, idOrApproval)
      : idOrApproval;

  if (!approval) {
    throw new NotFoundError('Approval request not found');
  }

  const id = approval.id;

  // Idempotency: if already EXECUTED, return without repeating mutation
  if (approval.status === 'EXECUTED') {
    return approval;
  }

  if (approval.status !== 'APPROVED') {
    throw new Error(`Cannot execute approval in status: ${approval.status}`);
  }

  // Execute based on actionType
  try {
    switch (approval.actionType) {
      case 'ORDER_CANCEL': {
        if (approval.targetEntityType !== 'Order' || !approval.targetEntityId) {
          throw new Error('Missing target order for ORDER_CANCEL approval');
        }

        // 1. Stale-State Revalidation
        const order = await findOrderByIdRow(db, ctx.workspaceId, approval.targetEntityId);
        if (!order) {
          throw new NotFoundError('Target order not found');
        }

        if (order.status === 'DELIVERED' || order.status === 'SHIPPED' || order.status === 'CANCELLED') {
          // Stale execution prevented
          const failed = await updateApprovalStatus(db, ctx.workspaceId, id, {
            status: 'FAILED',
            decisionReason: `Order is already ${order.status}. Cancellation could not be executed.`,
            executionResult: {
              error: 'STALE_STATE',
              orderStatus: order.status,
              message: `Order is already ${order.status}; cannot cancel.`,
            },
          });

          await appendAuditLog(db, {
            workspaceId: ctx.workspaceId,
            actorType: 'SYSTEM',
            action: 'APPROVAL_STALE_PREVENTED',
            resourceType: 'ActionApproval',
            resourceId: id,
            metadata: {
              actionType: approval.actionType,
              targetEntityId: approval.targetEntityId,
              currentStatus: order.status,
            },
          });

          return failed;
        }

        // 2. Execute domain cancellation
        const cancelled = await cancelOrder(ctx, order.id, {
          reason: approval.decisionReason || approval.reason || 'Staff approved cancellation',
        });

        const executed = await updateApprovalStatus(db, ctx.workspaceId, id, {
          status: 'EXECUTED',
          executedAt: new Date(),
          executionResult: {
            success: true,
            orderId: cancelled.id,
            orderNumber: cancelled.orderNumber,
            status: cancelled.status,
          },
        });

        await appendAuditLog(db, {
          workspaceId: ctx.workspaceId,
          actorType: 'USER',
          actorUserId: ctx.user.id,
          actorMemberId: ctx.membershipId,
          action: 'APPROVAL_EXECUTED',
          resourceType: 'ActionApproval',
          resourceId: id,
          metadata: {
            actionType: approval.actionType,
            orderNumber: cancelled.orderNumber,
          },
        });

        return executed;
      }

      case 'ADDRESS_CHANGE':
      case 'ORDER_MODIFY': {
        if (approval.targetEntityType !== 'Order' || !approval.targetEntityId) {
          throw new Error('Missing target order for order modification approval');
        }

        // Stale-State Revalidation
        const order = await findOrderByIdRow(db, ctx.workspaceId, approval.targetEntityId);
        if (!order) {
          throw new NotFoundError('Target order not found');
        }

        if (order.status !== 'DRAFT' && order.status !== 'PENDING') {
          const failed = await updateApprovalStatus(db, ctx.workspaceId, id, {
            status: 'FAILED',
            decisionReason: `Order is ${order.status}. Modification permitted only on draft or pending orders.`,
            executionResult: {
              error: 'STALE_STATE',
              orderStatus: order.status,
              message: `Cannot edit order after it has transitioned to ${order.status}`,
            },
          });

          await appendAuditLog(db, {
            workspaceId: ctx.workspaceId,
            actorType: 'SYSTEM',
            action: 'APPROVAL_STALE_PREVENTED',
            resourceType: 'ActionApproval',
            resourceId: id,
            metadata: {
              actionType: approval.actionType,
              orderStatus: order.status,
            },
          });

          return failed;
        }

        const payload = (approval.payload ?? {}) as UpdateOrderInput;
        const updated = await updateOrder(ctx, order.id, payload);

        const executed = await updateApprovalStatus(db, ctx.workspaceId, id, {
          status: 'EXECUTED',
          executedAt: new Date(),
          executionResult: {
            success: true,
            orderId: updated.id,
            orderNumber: updated.orderNumber,
          },
        });

        await appendAuditLog(db, {
          workspaceId: ctx.workspaceId,
          actorType: 'USER',
          actorUserId: ctx.user.id,
          actorMemberId: ctx.membershipId,
          action: 'APPROVAL_EXECUTED',
          resourceType: 'ActionApproval',
          resourceId: id,
          metadata: {
            actionType: approval.actionType,
            orderNumber: updated.orderNumber,
          },
        });

        return executed;
      }

      case 'REFUND_REQUEST': {
        // ConvoNexa has no autonomous payment disbursement integration.
        // Approval records human authorization for off-platform / accounting refund execution.
        const executed = await updateApprovalStatus(db, ctx.workspaceId, id, {
          status: 'EXECUTED',
          executedAt: new Date(),
          executionResult: {
            success: true,
            manualProcessingRequired: true,
            message: 'Refund request approved by management for manual off-platform processing.',
          },
        });

        await appendAuditLog(db, {
          workspaceId: ctx.workspaceId,
          actorType: 'USER',
          actorUserId: ctx.user.id,
          actorMemberId: ctx.membershipId,
          action: 'APPROVAL_EXECUTED',
          resourceType: 'ActionApproval',
          resourceId: id,
          metadata: {
            actionType: approval.actionType,
            manualProcessingRequired: true,
          },
        });

        return executed;
      }

      case 'EXCEPTIONAL_DISCOUNT': {
        // Exceptional discount approvals flag authorized customer concession
        const executed = await updateApprovalStatus(db, ctx.workspaceId, id, {
          status: 'EXECUTED',
          executedAt: new Date(),
          executionResult: {
            success: true,
            manualProcessingRequired: true,
            message: 'Exceptional discount approved by management.',
          },
        });

        await appendAuditLog(db, {
          workspaceId: ctx.workspaceId,
          actorType: 'USER',
          actorUserId: ctx.user.id,
          actorMemberId: ctx.membershipId,
          action: 'APPROVAL_EXECUTED',
          resourceType: 'ActionApproval',
          resourceId: id,
          metadata: {
            actionType: approval.actionType,
          },
        });

        return executed;
      }

      default: {
        throw new Error(`Unsupported approval action type: ${approval.actionType}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown execution error';
    const failed = await updateApprovalStatus(db, ctx.workspaceId, id, {
      status: 'FAILED',
      executionResult: {
        error: 'EXECUTION_FAILED',
        message: errorMsg,
      },
    });

    await appendAuditLog(db, {
      workspaceId: ctx.workspaceId,
      actorType: 'SYSTEM',
      action: 'APPROVAL_EXECUTION_FAILED',
      resourceType: 'ActionApproval',
      resourceId: id,
      metadata: {
        actionType: approval.actionType,
        error: errorMsg,
      },
    });

    return failed;
  }
}
