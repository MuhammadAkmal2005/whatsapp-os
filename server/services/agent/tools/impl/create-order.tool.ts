import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { findContactById } from '@/server/repositories/contact.repository';
import { findConversationById } from '@/server/repositories/conversation.repository';
import { createOrder } from '@/server/services/order/order.service';
import type { CreateOrderInput } from '@/server/validation/order';
import type { TenantContext } from '@/server/tenancy/context';

const createOrderAiInputSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid().describe('The ID of the product.'),
        variantId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe('The ID of the variant, if applicable.'),
        quantity: z.number().int().min(1).describe('The quantity of the item.'),
      }),
    )
    .min(1)
    .describe('List of items to order. ALWAYS retrieve products and their IDs first.'),
  paymentMethod: z
    .enum(['COD', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CARD', 'OTHER'])
    .optional()
    .describe('The payment method requested by the customer. Default is COD.'),
  customerName: z
    .string()
    .min(1)
    .optional()
    .describe('The customer name, if provided in conversation.'),
  addressLine1: z.string().optional().describe('Street address or building number.'),
  addressLine2: z.string().optional().describe('Apartment, suite, etc.'),
  city: z.string().optional().describe('City name.'),
  postalCode: z.string().optional().describe('Postal code.'),
  country: z.string().optional().describe('Country code (e.g. PK).'),
  notes: z.string().optional().describe('Any order notes or special instructions.'),
});

export const createOrderTool: AITool<
  z.infer<typeof createOrderAiInputSchema>,
  any
> = {
  name: 'create_order',
  description:
    'Creates a new order for the current customer. The system will automatically calculate totals, reserve inventory, and assign order numbers. ONLY call this if the customer has explicitly confirmed they want to place an order.',
  inputSchema: createOrderAiInputSchema,
  classification: 'WRITE',
  capabilityRequired: 'orders:create',
  sideEffect: 'MUTATION',
  idempotency: 'REQUIRES_IDEMPOTENCY_KEY',
  riskLevel: 'HIGH',
  auditRequired: true,
  handler: async (ctx: AITenantContext, input) => {
    const idempotencyKey = `ai-order:${ctx.messageId}:${ctx.executionId}`;

    // 1. Check idempotency
    const existingOrder = await prisma.order.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: ctx.workspaceId,
          idempotencyKey,
        },
      },
    });

    if (existingOrder) {
      return {
        success: true,
        message: 'Order already created for this request (idempotent return).',
        orderNumber: existingOrder.orderNumber,
        totalMinor: existingOrder.totalMinor,
        status: existingOrder.status,
      };
    }

    // 2. Load dependencies
    const [conversation, workspace] = await Promise.all([
      findConversationById(prisma, ctx.workspaceId, ctx.conversationId),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    ]);

    if (!conversation || !conversation.contactId) {
      return {
        error: 'NOT_FOUND',
        message: 'Current conversation or customer contact not found.',
      };
    }
    if (!workspace) {
      return {
        error: 'NOT_FOUND',
        message: 'Workspace not found.',
      };
    }

    const contact = await findContactById(prisma, ctx.workspaceId, conversation.contactId);
    if (!contact) {
      return {
        error: 'NOT_FOUND',
        message: 'Customer record not found.',
      };
    }

    // 3. Build input
    const createOrderInput: CreateOrderInput = {
      contactId: contact.id,
      conversationId: ctx.conversationId,
      items: input.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      })),
      customerName:
        input.customerName || contact.name || contact.waProfileName || 'Customer',
      phoneE164: contact.phoneE164,
      addressLine1: input.addressLine1 || contact.addressLine1 || undefined,
      addressLine2: input.addressLine2 || contact.addressLine2 || undefined,
      city: input.city || contact.city || undefined,
      postalCode: input.postalCode || contact.postalCode || undefined,
      country: input.country || 'PK',
      paymentMethod: input.paymentMethod || 'COD',
      notes: input.notes,
      idempotencyKey,
    };

    // 4. Build synthetic TenantContext for the service
    const tenantCtx = {
      workspaceId: ctx.workspaceId,
      workspaceName: workspace.name,
      membershipId: null as unknown as string,
      role: 'AGENT',
      permissions: new Set(['order:create']),
      currency: ctx.currency,
    } as unknown as TenantContext;

    // 5. Execute
    try {
      const order = await createOrder(tenantCtx, createOrderInput, {
        createdByAi: true,
        aiAgentId: ctx.agentId,
      });

      return {
        success: true,
        message: 'Order placed successfully.',
        orderNumber: order.orderNumber,
        totalMinor: order.totalMinor,
        status: order.status,
      };
    } catch (error: any) {
      // Check for Prisma unique constraint violation on idempotencyKey
      if (error?.code === 'P2002' && error?.meta?.target?.includes('idempotencyKey')) {
        const raceOrder = await prisma.order.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: ctx.workspaceId,
              idempotencyKey,
            },
          },
        });
        if (raceOrder) {
          return {
            success: true,
            message: 'Order already created for this request (idempotent return).',
            orderNumber: raceOrder.orderNumber,
            totalMinor: raceOrder.totalMinor,
            status: raceOrder.status,
          };
        }
      }

      return {
        error: 'ORDER_CREATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during order creation.',
      };
    }
  },
};
