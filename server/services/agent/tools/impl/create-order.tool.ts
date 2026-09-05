/**
 * `create_order` — the model proposes, the server prices.
 *
 * The input schema below is deliberately narrow: product ids, quantities, a payment
 * method and an address. There is no field for a unit price, a discount, a delivery fee,
 * a tax amount or a total, so there is nothing for the model to get wrong and nothing a
 * customer can talk it into. `order.service.ts` resolves every figure from the catalogue
 * and from the business's own settings, and this tool reports back what the server
 * decided.
 *
 * The response carries the whole breakdown for that reason. The agent has to tell the
 * customer what they owe, and the only safe way to let it is to hand it the server's own
 * numbers pre-formatted — so the sentence it writes cannot drift from the row that was
 * actually persisted.
 */

import 'server-only';

import { z } from 'zod';

import { prisma } from '@/db/prisma';
import { coerceCurrency, formatMoney, money } from '@/lib/money';
import { findContactById } from '@/server/repositories/contact.repository';
import { findConversationById } from '@/server/repositories/conversation.repository';
import { findStock } from '@/server/repositories/inventory.repository';
import { createOrder } from '@/server/services/order/order.service';
import type { WorkspaceActorContext } from '@/server/tenancy/context';
import type { CreateOrderInput } from '@/server/validation/order';
import {
  formatFriendlyPaymentMethods,
  isPaymentMethodSupported,
} from '../../business-rules.service';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';

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

/**
 * What an order came to: the authoritative integers, plus strings the agent can quote
 * without doing arithmetic of its own.
 */
export interface OrderTotalsDTO {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  subtotalDisplay: string;
  discountDisplay: string;
  deliveryFeeDisplay: string;
  taxDisplay: string;
  totalDisplay: string;
}

export interface CreateOrderSuccessDTO extends OrderTotalsDTO {
  success: true;
  message: string;
  orderNumber: string;
  status: string;
}

export interface CreateOrderErrorDTO {
  error: string;
  message: string;
  reason?: string;
}

export type CreateOrderToolResult =
  | CreateOrderSuccessDTO
  | CreateOrderErrorDTO;

/** Built from the persisted row, so what the agent says and what the database holds are
 *  the same numbers by construction rather than by coincidence. */
function toOrderTotalsDTO(row: {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}): OrderTotalsDTO {
  const currency = coerceCurrency(row.currency);
  const display = (minor: number): string => formatMoney(money(minor, currency));

  return {
    currency,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    subtotalDisplay: display(row.subtotalMinor),
    discountDisplay: display(row.discountMinor),
    deliveryFeeDisplay: display(row.deliveryFeeMinor),
    taxDisplay: display(row.taxMinor),
    totalDisplay: display(row.totalMinor),
  };
}

/**
 * Whether a thrown value is the unique-constraint violation on the idempotency key.
 *
 * Narrowed from `unknown` structurally rather than with an `instanceof` check: the error
 * crosses a module boundary from Prisma, and the code and the target are the only parts of
 * it this cares about. Prisma reports `meta.target` as either the column list or the index
 * name depending on the driver, so both are handled.
 */
function isIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error) || error.code !== 'P2002') return false;
  if (!('meta' in error) || typeof error.meta !== 'object' || error.meta === null) {
    return false;
  }
  if (!('target' in error.meta)) return false;

  const target = error.meta.target;
  if (typeof target === 'string') return target.includes('idempotencyKey');
  return (
    Array.isArray(target) &&
    target.some((entry) => typeof entry === 'string' && entry.includes('idempotencyKey'))
  );
}

export const createOrderTool: AITool<
  z.infer<typeof createOrderAiInputSchema>,
  CreateOrderToolResult
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
        status: existingOrder.status,
        ...toOrderTotalsDTO(existingOrder),
      };
    }

    // 2. Load dependencies
    const [conversation, workspace, businessProfile] = await Promise.all([
      findConversationById(prisma, ctx.workspaceId, ctx.conversationId),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId } }),
      prisma.businessProfile.findUnique({ where: { workspaceId: ctx.workspaceId } }),
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

    // 3. Level 3 Business Rule Gate: Payment Method Verification
    const requestedPaymentMethod = input.paymentMethod || 'COD';
    const configuredMethods = businessProfile?.paymentMethods;
    if (configuredMethods && configuredMethods.length > 0) {
      if (!isPaymentMethodSupported(requestedPaymentMethod, configuredMethods)) {
        const friendlyMethods = formatFriendlyPaymentMethods(configuredMethods);
        return {
          error: 'REJECTED_BY_RULE',
          reason: 'PAYMENT_METHOD_NOT_SUPPORTED',
          message: `Payment method ${requestedPaymentMethod} is not accepted by this business. Accepted payment methods are: ${friendlyMethods}.`,
        };
      }
    }

    // 4. Level 1 Domain Pre-checks: Product Existence & Inventory
    const productIds = input.items.map((item) => item.productId);
    const existingProducts = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      include: {
        variants: true,
      },
    });

    const productMap = new Map(existingProducts.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return {
          error: 'PRODUCT_NOT_FOUND',
          message: `Product not found in catalog: ${item.productId}. Always search or verify products first.`,
        };
      }

      if (item.variantId) {
        const variant = product.variants.find((v) => v.id === item.variantId);
        if (!variant) {
          return {
            error: 'VARIANT_NOT_FOUND',
            message: `Variant with ID ${item.variantId} not found for product "${product.name}".`,
          };
        }
      }

      if (product.trackInventory) {
        const stock = await findStock(prisma, ctx.workspaceId, product.id, item.variantId ?? null);
        if (!stock || stock.available < item.quantity) {
          const available = stock?.available ?? 0;
          return {
            error: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for "${product.name}". Available: ${available}, requested: ${item.quantity}.`,
          };
        }
      }
    }

    // 5. Build input
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
      paymentMethod: requestedPaymentMethod,
      notes: input.notes,
      idempotencyKey,
    };

    // 6. Best-effort sync of customer address/name if provided in input
    if (input.addressLine1 || input.city || input.postalCode || input.customerName) {
      const contactUpdates: Record<string, string> = {};
      if (input.customerName && !contact.name) contactUpdates.name = input.customerName;
      if (input.addressLine1 && !contact.addressLine1) contactUpdates.addressLine1 = input.addressLine1;
      if (input.addressLine2 && !contact.addressLine2) contactUpdates.addressLine2 = input.addressLine2;
      if (input.city && !contact.city) contactUpdates.city = input.city;
      if (input.postalCode && !contact.postalCode) contactUpdates.postalCode = input.postalCode;

      if (Object.keys(contactUpdates).length > 0) {
        await prisma.contact.updateMany({
          where: { id: contact.id, workspaceId: ctx.workspaceId, deletedAt: null },
          data: contactUpdates,
        }).catch(() => {
          // Non-blocking best effort sync
        });
      }
    }

    // 7. Build the actor context for the service.
    const actorCtx: WorkspaceActorContext = {
      workspaceId: ctx.workspaceId,
      workspaceName: workspace.name,
      membershipId: null,
      role: 'AGENT',
      currency: coerceCurrency(workspace.currency),
    };

    // 8. Execute order creation with authoritative server pricing
    try {
      const order = await createOrder(actorCtx, createOrderInput, {
        createdByAi: true,
        aiAgentId: ctx.agentId,
      });

      return {
        success: true,
        message:
          'Order placed successfully. The amounts below are the server\'s own figures, ' +
          'calculated from the catalogue and this business\'s delivery and tax settings. ' +
          'Quote them to the customer exactly as given and do not recalculate them.',
        orderNumber: order.orderNumber,
        status: order.status,
        ...toOrderTotalsDTO(order),
      };
    } catch (error: unknown) {
      // A concurrent turn won the race on the same idempotency key. The order exists, so
      // returning it is the correct answer rather than an error the customer would see as
      // a failed purchase.
      if (isIdempotencyConflict(error)) {
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
            status: raceOrder.status,
            ...toOrderTotalsDTO(raceOrder),
          };
        }
      }

      const msg = error instanceof Error ? error.message : 'Unknown error during order creation.';
      const isStockErr = /insufficient stock/i.test(msg);
      return {
        error: isStockErr ? 'INSUFFICIENT_STOCK' : 'ORDER_CREATION_FAILED',
        message: msg,
      };
    }
  },
};
