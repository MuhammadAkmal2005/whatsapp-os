import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITool } from '../tool-contract';
import type { AITenantContext } from '../../context';
import { createApprovalRequest } from '@/server/services/approval/approval.service';
import { triggerHumanHandoff } from '@/server/services/agent/handoff.service';
import { findConversationById } from '@/server/repositories/conversation.repository';

const requestOrderCancellationInputSchema = z.object({
  orderNumberOrId: z
    .string()
    .min(1)
    .describe('The order number (e.g. "CN-2609-0010") or order ID to request cancellation for.'),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('The customer\'s reason for requesting cancellation.'),
});

export type RequestOrderCancellationInput = z.infer<
  typeof requestOrderCancellationInputSchema
>;

export type RequestOrderCancellationToolResult =
  | {
      success: true;
      status: 'PENDING_APPROVAL';
      approvalId: string;
      orderNumber: string;
      message: string;
    }
  | {
      error: string;
      message: string;
    };

export const requestOrderCancellationTool: AITool<
  RequestOrderCancellationInput,
  RequestOrderCancellationToolResult
> = {
  name: 'request_order_cancellation',
  description:
    'Submits a formal request for staff approval to cancel an order. Call this when a customer asks to cancel their order. Do NOT claim the order is cancelled; it requires staff review.',
  classification: 'WRITE',
  capabilityRequired: 'orders:create',
  sideEffect: 'MUTATION',
  idempotency: 'REQUIRES_IDEMPOTENCY_KEY',
  riskLevel: 'HIGH',
  auditRequired: true,
  inputSchema: requestOrderCancellationInputSchema,
  handler: async (ctx: AITenantContext, input: RequestOrderCancellationInput): Promise<RequestOrderCancellationToolResult> => {
    // 1. Locate order by ID or orderNumber within the tenant
    const order = await prisma.order.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        OR: [
          { id: input.orderNumberOrId },
          { orderNumber: input.orderNumberOrId.trim() },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        contactId: true,
        status: true,
        paymentStatus: true,
      },
    });

    if (!order) {
      return {
        error: 'ORDER_NOT_FOUND',
        message: `Order "${input.orderNumberOrId}" was not found in your account. Please check the order number.`,
      };
    }

    // 2. Validate customer relationship if conversation has contact
    if (ctx.conversationId) {
      const conversation = await findConversationById(
        prisma,
        ctx.workspaceId,
        ctx.conversationId,
      );
      if (
        conversation?.contactId &&
        order.contactId &&
        conversation.contactId !== order.contactId
      ) {
        return {
          error: 'UNAUTHORIZED_ORDER_ACCESS',
          message: 'This order does not belong to the current customer contact.',
        };
      }
    }

    // 3. Domain pre-check: Cannot cancel already cancelled or delivered orders
    if (order.status === 'CANCELLED') {
      return {
        error: 'ALREADY_CANCELLED',
        message: `Order ${order.orderNumber} is already cancelled.`,
      };
    }

    if (order.status === 'DELIVERED') {
      return {
        error: 'CANNOT_CANCEL_DELIVERED',
        message: `Order ${order.orderNumber} has already been delivered. Delivered orders cannot be cancelled; please ask our team about returns.`,
      };
    }

    // 4. Create ActionApproval request with idempotency key
    const idempotencyKey = `approval:cancel:${ctx.messageId}:${order.id}`;
    const approval = await createApprovalRequest(ctx, {
      actionType: 'ORDER_CANCEL',
      conversationId: ctx.conversationId,
      contactId: order.contactId,
      targetEntityType: 'Order',
      targetEntityId: order.id,
      reason: input.reason,
      idempotencyKey,
    });

    // 5. Trigger human handoff so staff can review and process
    if (ctx.conversationId) {
      await triggerHumanHandoff(
        prisma,
        ctx.workspaceId,
        ctx.conversationId,
        'CUSTOMER_REQUESTED',
        true,
      );
    }

    return {
      success: true,
      status: 'PENDING_APPROVAL',
      approvalId: approval.id,
      orderNumber: order.orderNumber,
      message: `Your cancellation request for order ${order.orderNumber} has been submitted to our team for review. A staff member will confirm your cancellation shortly.`,
    };
  },
};
