import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { findConversationById } from '@/server/repositories/conversation.repository';
import { findOrderByNumberForContact } from '@/server/repositories/order.repository';
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '@/server/validation/order';

export interface OrderItemDTO {
  name: string;
  sku?: string;
  variant?: string;
  unitPriceMinor: number;
  quantity: number;
  lineSubtotalMinor: number;
}

export interface GetOrderResultDTO {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  itemCount: number;
  items: OrderItemDTO[];
  courierName?: string;
  trackingNumber?: string;
  placedAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export const getOrderTool: AITool<
  { orderNumber: string },
  GetOrderResultDTO | { error: string; message: string }
> = {
  name: 'get_order',
  description:
    'Retrieve status, tracking, items, and total for an order placed by the customer in the current conversation.',
  inputSchema: z.object({
    orderNumber: z
      .string()
      .trim()
      .min(1, 'Order number must be at least 1 character')
      .max(50, 'Order number cannot exceed 50 characters')
      .describe('The human-facing order number (e.g. "AF-2608-0042")'),
  }),
  classification: 'READ',
  capabilityRequired: 'orders:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext, input) => {
    const conversation = await findConversationById(prisma, ctx.workspaceId, ctx.conversationId);

    if (!conversation || !conversation.contactId) {
      return {
        error: 'NOT_FOUND',
        message: 'Current conversation or customer contact not found.',
      };
    }

    const order = await findOrderByNumberForContact(
      prisma,
      ctx.workspaceId,
      input.orderNumber,
      conversation.contactId,
    );

    if (!order) {
      return {
        error: 'NOT_FOUND',
        message: 'Order not found for this customer.',
      };
    }

    const items: OrderItemDTO[] = order.items.map((item) => ({
      name: item.nameSnapshot,
      sku: item.skuSnapshot ?? undefined,
      variant: item.variantSnapshot ?? undefined,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineSubtotalMinor: item.lineSubtotalMinor,
    }));

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      itemCount: items.length,
      items,
      courierName: order.courierName ?? undefined,
      trackingNumber: order.trackingNumber ?? undefined,
      placedAt: order.placedAt.toISOString(),
      deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : undefined,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : undefined,
      cancelReason: order.cancelReason ?? undefined,
    };
  },
};
