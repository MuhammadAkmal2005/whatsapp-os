/**
 * Orders.
 *
 * A service that does three things:
 *
 *   1. **Server-side total calculation.** Every amount — subtotal, discount, delivery,
 *      tax, total — is computed from database prices. The client's numbers are discarded.
 *   2. **Inventory orchestration.** A new order reserves stock; cancellation releases it;
 *      fulfilment converts reserved to sold.
 *   3. **Contact aggregates.** The contact's totalOrders, totalSpentMinor and lastOrderAt
 *      are updated inside the same transaction as the order, so they never drift.
 *
 * Every call is wrapped in a Prisma transaction to keep these three atomic. A failed
 * stock reservation rolls back the whole order. A partial failure in updating the
 * contact leaves the order uncommitted.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import {
  createOrder as createOrderRow,
  createOrderEvent as createOrderEventRow,
  findOrderById as findOrderByIdRow,
  findOrderDetail as findOrderDetailRow,
  findOrderByNumber as findOrderByNumberRow,
  listOrders as listOrdersRow,
  countOrdersByStatus as countOrdersByStatusRow,
  generateOrderNumber as generateOrderNumberRow,
  softDeleteOrder as softDeleteOrderRow,
  updateOrder as updateOrderRow,
  type OrderDetailRow,
  type OrderListRow,
  type OrderRow,
  type OrderWriteFields,
  type OrderItemWriteFields,
} from '@/server/repositories/order.repository';
import { findContactById as findContactByIdRow } from '@/server/repositories/contact.repository';
import {
  findStock,
  reserveStock,
  releaseStock,
  markSold,
} from '@/server/repositories/inventory.repository';
import { findBusinessMoneySettings } from '@/server/repositories/workspace.repository';
import { add, coerceCurrency, money, type Money } from '@/lib/money';
import { ORDER_BUILDER_CATALOGUE_LIMIT, type SupportedCurrency } from '@/config/constants';
import { listOrderableProducts } from '@/server/repositories/product.repository';
import { computeOrderTotals } from '@/server/domain/order-totals';
import { resolvePrice } from '@/server/services/product/pricing';
import {
  orderCapability,
  orderListCapability,
  type OrderCapability,
  type OrderListCapability,
} from '@/server/services/order/order.capability';
import {
  requirePermission,
  type TenantContext,
  type WorkspaceActorContext,
} from '@/server/tenancy/context';
import type {
  CancelOrderInput,
  CreateOrderInput,
  OrderFiltersInput,
  UpdateOrderInput,
  UpdateOrderStatusInput,
} from '@/server/validation/order';
import { isLegalStatusTransition } from '@/server/validation/order';

// ── View types ─────────────────────────────────────────────────────────────
//
// The rows the repository returns carry integer minor units. The UI wants `Money`
// values it can hand straight to `formatMoney`, plus the capability flags that decide
// which controls to draw. These view types are what the pages consume.

export type OrderMoney = {
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  tax: Money;
  total: Money;
};

export type OrderSummary = OrderListRow & {
  money: OrderMoney;
};

export type OrderItemView = {
  id: string;
  productId: string | null;
  variantId: string | null;
  nameSnapshot: string;
  skuSnapshot: string | null;
  variantSnapshot: string | null;
  unitPrice: Money;
  quantity: number;
  lineSubtotal: Money;
};

export type OrderDetail = OrderDetailRow & {
  money: OrderMoney;
  itemViews: OrderItemView[];
  can: OrderCapability;
};

export type OrderListPage = {
  orders: OrderSummary[];
  nextCursor: string | null;
  statusCounts: Record<string, number>;
  can: OrderListCapability;
};

/** Wraps an order row's minor-unit fields in `Money` for display. */
function toOrderMoney(row: {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}): OrderMoney {
  const currency = coerceCurrency(row.currency);
  return {
    subtotal: money(row.subtotalMinor, currency),
    discount: money(row.discountMinor, currency),
    deliveryFee: money(row.deliveryFeeMinor, currency),
    tax: money(row.taxMinor, currency),
    total: money(row.totalMinor, currency),
  };
}

// ── Order creation ───────────────────────────────────────────────────────────

/**
 * Creates an order with server-calculated totals and inventory reservation.
 *
 * 1. Load the contact.
 * 2. Load each product/variant and resolve the current price.
 * 3. Resolve the business's own delivery and tax settings, then price the order
 *    through `server/domain/order-totals`.
 * 4. Create the order and items inside a transaction.
 * 5. Reserve stock in the same transaction.
 * 6. Update contact aggregates.
 *
 * Takes a `WorkspaceActorContext` rather than a `TenantContext` because the AI agent
 * creates orders too and is not a workspace member. A `TenantContext` satisfies it,
 * so every human call site is unaffected; see the type's own note for why the
 * alternative — a cast that fabricated a membership id — was worse.
 */
export async function createOrder(
  ctx: WorkspaceActorContext,
  input: CreateOrderInput,
  options?: { createdByAi?: boolean; aiAgentId?: string },
): Promise<OrderRow> {
  requirePermission(ctx, 'order:create');

  const db = prisma;

  return db.$transaction(async (tx) => {
    // 1. Load contact
    const contact = await findContactByIdRow(tx, ctx.workspaceId, input.contactId);
    if (!contact) {
      throw new NotFoundError('Contact not found');
    }

    // 2. Load products and variants, compute prices
    const productIds = new Set<string>();
    const variantIds = new Set<string>();

    for (const item of input.items) {
      productIds.add(item.productId);
      if (item.variantId) {
        variantIds.add(item.variantId);
      }
    }

    // Load products with variants
    const products = await tx.product.findMany({
      where: { id: { in: Array.from(productIds) }, workspaceId: ctx.workspaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        priceMinor: true,
        salePriceMinor: true,
        currency: true,
        trackInventory: true,
        variants: {
          where: variantIds.size > 0 ? { id: { in: Array.from(variantIds) } } : undefined,
          select: {
            id: true,
            sku: true,
            name: true,
            size: true,
            color: true,
            priceMinor: true,
            salePriceMinor: true,
          },
        },
      },
    });

    const productMap = new Map<string, typeof products[0]>();
    for (const p of products) {
      productMap.set(p.id, p);
    }

    // Build items with prices and validate stock. The subtotal is deliberately not
    // accumulated here — `computeOrderTotals` sums the lines below, and two independent
    // additions of the same numbers is one more than the order needs.
    const finalItems: OrderItemWriteFields[] = [];

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundError(`Product not found: ${item.productId}`);
      }

      // Get variant if specified
      let variant = null;
      if (item.variantId) {
        variant = product.variants.find((v) => v.id === item.variantId) ?? null;
        if (!variant) {
          throw new NotFoundError(`Variant not found: ${item.variantId}`);
        }
      }

      // Resolve price (effective price from product/variant)
      const productPrice = resolvePrice(
        {
          priceMinor: product.priceMinor,
          salePriceMinor: product.salePriceMinor,
          currency: product.currency,
        },
        variant
          ? {
              priceMinor: variant.priceMinor,
              salePriceMinor: variant.salePriceMinor,
            }
          : null,
      );

      const unitPriceMinor = productPrice.effective.minor;
      const lineSubtotalMinor = unitPriceMinor * item.quantity;

      // Validate stock if tracking inventory
      if (product.trackInventory) {
        const stock = await findStock(tx, ctx.workspaceId, product.id, item.variantId ?? null);
        if (!stock) {
          throw new Error(`Stock record not found for product: ${product.name}`);
        }
        if (stock.available < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }
      }

      finalItems.push({
        productId: product.id,
        variantId: item.variantId ?? null,
        nameSnapshot: variant?.name ?? product.name,
        skuSnapshot: variant?.sku ?? product.sku,
        variantSnapshot: variant
          ? [variant.size, variant.color].filter(Boolean).join(', ')
          : null,
        unitPriceMinor,
        quantity: item.quantity,
        lineSubtotalMinor,
      });
    }

    // 3. Price the order from authoritative data.
    //
    // Everything beyond the goods value is the business's own policy, read from its
    // profile inside this transaction, and the arithmetic belongs to
    // `server/domain/order-totals` — the one engine the unit tests pin. Nothing here
    // re-derives a total.
    //
    // Who may override what is the security-relevant part. A human filling in the
    // dashboard's order builder is looking at the order and deciding, and
    // `server/validation/order.ts` documents `discountMinor`, `deliveryFeeMinor` and
    // `taxMinor` as exactly that — so they are honoured. An AI-created order has no such
    // standing: the model's arguments are untrusted input, so they are discarded here,
    // before the arithmetic, and the configured settings decide instead.
    const honourCallerAmounts = options?.createdByAi !== true;
    const settings = await findBusinessMoneySettings(tx, ctx.workspaceId);
    const currency = ctx.currency;

    const requestedDiscountMinor = honourCallerAmounts ? (input.discountMinor ?? 0) : 0;
    const overrideDeliveryFeeMinor = honourCallerAmounts ? input.deliveryFeeMinor : undefined;
    const overrideTaxMinor = honourCallerAmounts ? input.taxMinor : undefined;

    // An explicitly entered fee is taken literally, waiver included: the threshold is the
    // business's rule for its *configured* fee, and applying it to a figure a human just
    // typed would silently erase what they entered.
    const usesConfiguredDelivery = overrideDeliveryFeeMinor === undefined;
    const deliveryFee = money(
      usesConfiguredDelivery ? settings.deliveryFeeMinor : overrideDeliveryFeeMinor,
      currency,
    );
    const freeDeliveryThreshold =
      usesConfiguredDelivery && settings.freeDeliveryThresholdMinor !== null
        ? money(settings.freeDeliveryThresholdMinor, currency)
        : undefined;

    const totals = computeOrderTotals({
      currency,
      // Built with the order's currency rather than each product's, so the figures the
      // engine adds up are the same integers persisted on the items.
      lines: finalItems.map((item) => ({
        unitPrice: money(item.unitPriceMinor, currency),
        quantity: item.quantity,
      })),
      discount: money(requestedDiscountMinor, currency),
      deliveryFee,
      freeDeliveryThreshold,
      // The engine takes a rate, not an amount, so an explicitly entered tax figure is
      // applied by running the engine at zero and adding it afterwards with integer money
      // arithmetic. The engine keeps ownership of everything else.
      taxBasisPoints: overrideTaxMinor === undefined ? settings.taxRateBps : 0,
    });

    const overrideTax = money(overrideTaxMinor ?? 0, currency);
    const taxMinor = add(totals.tax, overrideTax).minor;
    const totalMinor = add(totals.total, overrideTax).minor;

    // Taken from the engine's own figures so the stored columns reconcile:
    // subtotal - discount + delivery + tax always equals total. The discount is the
    // *applied* amount, which matters when a shop owner enters one larger than the
    // basket — the engine clamps that to a free order, and storing the request rather
    // than the clamp would leave a row whose columns do not add up.
    const subtotalMinor = totals.subtotal.minor;
    const discountMinor = totals.discount.minor;
    const deliveryFeeMinor = totals.deliveryFee.minor;

    // 4. Generate order number
    const businessName = ctx.workspaceName;
    const orderNumber = await generateOrderNumberRow(tx, ctx.workspaceId, businessName, new Date());

    // 5. Create the order
    const orderInput: OrderWriteFields = {
      orderNumber,
      contactId: contact.id,
      conversationId: input.conversationId ?? null,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'UNFULFILLED',
      currency: ctx.currency,
      subtotalMinor,
      discountMinor,
      deliveryFeeMinor,
      taxMinor,
      totalMinor,
      paymentMethod: input.paymentMethod,
      customerName: input.customerName,
      phoneE164: input.phoneE164,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country,
      notes: input.notes ?? null,
      createdByMemberId: ctx.membershipId,
      createdByAi: options?.createdByAi ?? false,
      aiAgentId: options?.aiAgentId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    };

    const order = await createOrderRow(
      tx,
      { ...orderInput, workspaceId: ctx.workspaceId },
      finalItems,
    );

    // 6. Reserve stock for each item
    for (const item of finalItems) {
      if (item.productId) {
        await reserveStock(
          tx,
          ctx.workspaceId,
          item.productId,
          item.variantId,
          item.quantity,
        );
      }
    }

    // 7. Update contact aggregates
    await tx.contact.update({
      where: { id: contact.id, workspaceId: ctx.workspaceId },
      data: {
        totalOrders: { increment: 1 },
        totalSpentMinor: { increment: totalMinor },
        lastOrderAt: new Date(),
        lastInteractionAt: new Date(),
        status: contact.totalOrders === 0 ? 'NEW' : 'RETURNING',
      },
    });

    // 8. Create initial order event
    await createOrderEventRow(tx, {
      workspaceId: ctx.workspaceId,
      orderId: order.id,
      type: 'ORDER_CREATED',
      fromStatus: null,
      toStatus: 'PENDING',
      actorMemberId: ctx.membershipId,
      byAi: options?.createdByAi ?? false,
      note: null,
    });

    return order;
  });
}

// ── Order updates ────────────────────────────────────────────────────────────

/**
 * Updates an order's mutable fields.
 */
export async function updateOrder(
  ctx: TenantContext,
  orderId: string,
  input: UpdateOrderInput,
): Promise<OrderRow> {
  requirePermission(ctx, 'order:update');

  const db = prisma;

  const order = await findOrderByIdRow(db, ctx.workspaceId, orderId);
  if (!order) {
    throw new NotFoundError('Order not found');
  }

  // Only allow editing draft or pending orders
  if (order.status !== 'DRAFT' && order.status !== 'PENDING') {
    throw new Error('Cannot edit order after it has been confirmed');
  }

  const result = await updateOrderRow(db, ctx.workspaceId, orderId, input);
  if (result === 0) {
    throw new NotFoundError('Order not found');
  }

  const updated = await findOrderByIdRow(db, ctx.workspaceId, orderId);
  if (!updated) {
    throw new NotFoundError('Order not found');
  }

  return updated;
}

// ── Status updates ───────────────────────────────────────────────────────────

/**
 * Updates the order status.
 *
 * Enforces legal status transitions and updates inventory appropriately.
 */
export async function updateOrderStatus(
  ctx: TenantContext,
  orderId: string,
  input: UpdateOrderStatusInput,
): Promise<OrderRow> {
  requirePermission(ctx, 'order:update_status');

  const db = prisma;

  return db.$transaction(async (tx) => {
    const order = await findOrderByIdRow(tx, ctx.workspaceId, orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Validate transition
    if (!isLegalStatusTransition(order.status, input.status)) {
      throw new Error(`Cannot transition from ${order.status} to ${input.status}`);
    }

    // Inventory implications of the transition. Reserved stock is held from creation;
    // it is released on cancellation and converted to sold on delivery. Guarding each
    // movement against a double transition is the repository's job (its `gte` filters),
    // so this only decides which movement to apply.
    const affectsStock =
      input.status === 'CANCELLED' || input.status === 'DELIVERED';

    if (affectsStock) {
      const items = await tx.orderItem.findMany({
        where: { orderId, workspaceId: ctx.workspaceId },
        select: { productId: true, variantId: true, quantity: true },
      });

      for (const item of items) {
        if (!item.productId) continue;
        if (input.status === 'CANCELLED') {
          // Put the held units back on the shelf.
          await releaseStock(
            tx,
            ctx.workspaceId,
            item.productId,
            item.variantId,
            item.quantity,
          );
        } else {
          // DELIVERED: the units have left the building. Reserved → sold.
          await markSold(
            tx,
            ctx.workspaceId,
            item.productId,
            item.variantId,
            item.quantity,
          );
        }
      }
    }

    // Build update data based on status
    const updateData: Record<string, unknown> = {
      status: input.status,
    };

    if (input.status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      if (input.note) {
        updateData.cancelReason = input.note;
      }
    } else if (input.status === 'CONFIRMED') {
      updateData.confirmedAt = new Date();
    } else if (input.status === 'SHIPPED') {
      updateData.shippedAt = new Date();
    } else if (input.status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
      updateData.fulfillmentStatus = 'FULFILLED';
      // Cash on delivery is paid at delivery; other methods keep their own status.
      if (order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID') {
        updateData.paymentStatus = 'PAID';
      }
    }

    // Update the order
    const result = await tx.order.updateMany({
      where: { id: orderId, workspaceId: ctx.workspaceId, deletedAt: null },
      data: updateData,
    });

    if (result.count === 0) {
      throw new NotFoundError('Order not found');
    }

    // Create event
    await createOrderEventRow(tx, {
      workspaceId: ctx.workspaceId,
      orderId,
      type: `STATUS_${input.status}`,
      fromStatus: order.status,
      toStatus: input.status,
      actorMemberId: ctx.membershipId,
      byAi: false,
      note: input.note ?? null,
    });

    const updated = await findOrderByIdRow(tx, ctx.workspaceId, orderId);
    if (!updated) {
      throw new NotFoundError('Order not found');
    }

    return updated;
  });
}

// ── Cancellation ─────────────────────────────────────────────────────────────

/**
 * Cancels an order with a reason.
 */
export async function cancelOrder(
  ctx: TenantContext,
  orderId: string,
  input: CancelOrderInput,
): Promise<OrderRow> {
  requirePermission(ctx, 'order:cancel');

  const db = prisma;

  return db.$transaction(async (tx) => {
    const order = await findOrderByIdRow(tx, ctx.workspaceId, orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Validate order can be cancelled
    if (order.status === 'CANCELLED') {
      throw new Error('Order is already cancelled');
    }
    if (order.status === 'DELIVERED') {
      throw new Error('Cannot cancel a delivered order');
    }
    if (order.status === 'REFUNDED') {
      throw new Error('Cannot cancel a refunded order');
    }

    // Release stock
    const items = await tx.orderItem.findMany({
      where: { orderId, workspaceId: ctx.workspaceId },
      select: { productId: true, variantId: true, quantity: true },
    });

    for (const item of items) {
      if (item.productId) {
        await releaseStock(
          tx,
          ctx.workspaceId,
          item.productId,
          item.variantId,
          item.quantity,
        );
      }
    }

    // Update order
    const result = await tx.order.updateMany({
      where: { id: orderId, workspaceId: ctx.workspaceId, deletedAt: null },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
    });

    if (result.count === 0) {
      throw new NotFoundError('Order not found');
    }

    // Create event
    await createOrderEventRow(tx, {
      workspaceId: ctx.workspaceId,
      orderId,
      type: 'ORDER_CANCELLED',
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      actorMemberId: ctx.membershipId,
      byAi: false,
      note: input.reason,
    });

    const updated = await findOrderByIdRow(tx, ctx.workspaceId, orderId);
    if (!updated) {
      throw new NotFoundError('Order not found');
    }

    return updated;
  });
}

// ── List and detail ──────────────────────────────────────────────────────────

/** Maps a list row to the summary the list UI consumes. */
function toOrderSummary(row: OrderListRow): OrderSummary {
  return { ...row, money: toOrderMoney(row) };
}

/**
 * Lists orders with filters, returning display-ready summaries alongside the
 * status counts the filter bar renders and the capability flags the list header
 * uses to decide whether to show the "New order" control.
 */
export async function listOrders(
  ctx: TenantContext,
  filters: OrderFiltersInput,
): Promise<OrderListPage> {
  requirePermission(ctx, 'order:read');

  const [page, statusCounts] = await Promise.all([
    listOrdersRow(prisma, ctx.workspaceId, {
      ...filters,
      search: filters.search ?? null,
    }),
    countOrdersByStatusRow(prisma, ctx.workspaceId),
  ]);

  return {
    orders: page.rows.map(toOrderSummary),
    nextCursor: page.nextCursor,
    statusCounts,
    can: orderListCapability(ctx),
  };
}

/** Maps an item row to the display view, wrapping money fields. */
function toOrderItemView(
  item: OrderDetailRow['items'][number],
  currency: string,
): OrderItemView {
  const cur = coerceCurrency(currency);
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    nameSnapshot: item.nameSnapshot,
    skuSnapshot: item.skuSnapshot,
    variantSnapshot: item.variantSnapshot,
    unitPrice: money(item.unitPriceMinor, cur),
    quantity: item.quantity,
    lineSubtotal: money(item.lineSubtotalMinor, cur),
  };
}

/**
 * Gets a single order by ID for display, with money wrapped for rendering and
 * the capability flags that decide which status/cancel controls to draw.
 * Returns null when the order is absent so the page can render a 404.
 */
export async function getOrderDetail(
  ctx: TenantContext,
  orderId: string,
): Promise<OrderDetail | null> {
  requirePermission(ctx, 'order:read');

  const row = await findOrderDetailRow(prisma, ctx.workspaceId, orderId);
  if (!row) {
    return null;
  }

  return {
    ...row,
    money: toOrderMoney(row),
    itemViews: row.items.map((item) => toOrderItemView(item, row.currency)),
    can: orderCapability(ctx),
  };
}

/**
 * Gets an order by its human-readable order number.
 */
export async function getOrderByNumber(
  ctx: TenantContext,
  orderNumber: string,
): Promise<OrderRow | null> {
  requirePermission(ctx, 'order:read');

  return findOrderByNumberRow(prisma, ctx.workspaceId, orderNumber);
}

// ── Orderable catalogue ──────────────────────────────────────────────────────
//
// What the manual order builder shows in its product picker. One orderable unit per
// row — the product itself when it has no variants, otherwise each variant — carrying
// a display price and an available count. These prices are advisory: the builder shows
// a running estimate with them, but `createOrder` re-derives every price from the
// database, so the figure a customer is charged never comes from this list.

export type OrderableOption = {
  /** Stable identity for selection and React keys: the product id, or `productId:variantId`. */
  key: string;
  productId: string;
  variantId: string | null;
  label: string;
  sku: string | null;
  unitPriceMinor: number;
  /** null when the product does not track inventory — there is no shelf to count. */
  available: number | null;
};

export type OrderableProduct = {
  productId: string;
  name: string;
  options: OrderableOption[];
};

export type OrderableCatalogue = {
  products: OrderableProduct[];
  currency: SupportedCurrency;
  /** True when the catalogue is larger than the picker's cap and was trimmed. */
  truncated: boolean;
};

/** The human label for a variant — its own name, else its size/colour, else a fallback. */
function variantLabel(variant: { name: string | null; size: string | null; color: string | null }): string {
  if (variant.name) return variant.name;
  const parts = [variant.size, variant.color].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Variant';
}

/** Maps one product row to its orderable options, resolving prices and stock. */
function toOrderableProduct(row: Awaited<ReturnType<typeof listOrderableProducts>>[number]): OrderableProduct {
  const stockByVariant = new Map<string | null, number>();
  for (const entry of row.stock) {
    stockByVariant.set(entry.variantId, entry.available);
  }

  const tracks = row.trackInventory;
  const options: OrderableOption[] =
    row.variants.length > 0
      ? row.variants.map((variant) => {
          const price = resolvePrice(row, variant);
          return {
            key: `${row.id}:${variant.id}`,
            productId: row.id,
            variantId: variant.id,
            label: `${row.name} — ${variantLabel(variant)}`,
            sku: variant.sku ?? row.sku,
            unitPriceMinor: price.effective.minor,
            available: tracks ? (stockByVariant.get(variant.id) ?? 0) : null,
          };
        })
      : [
          {
            key: row.id,
            productId: row.id,
            variantId: null,
            label: row.name,
            sku: row.sku,
            unitPriceMinor: resolvePrice(row).effective.minor,
            available: tracks ? (stockByVariant.get(null) ?? 0) : null,
          },
        ];

  return { productId: row.id, name: row.name, options };
}

/**
 * The active catalogue the manual order builder offers, as orderable options.
 */
export async function getOrderableCatalogue(ctx: TenantContext): Promise<OrderableCatalogue> {
  requirePermission(ctx, 'order:create');

  // One past the cap, so we can tell an exactly-full catalogue from a trimmed one and
  // warn the person that some products are only reachable by search.
  const rows = await listOrderableProducts(
    prisma,
    ctx.workspaceId,
    ORDER_BUILDER_CATALOGUE_LIMIT + 1,
  );

  const truncated = rows.length > ORDER_BUILDER_CATALOGUE_LIMIT;
  const visible = truncated ? rows.slice(0, ORDER_BUILDER_CATALOGUE_LIMIT) : rows;

  return {
    products: visible.map(toOrderableProduct),
    currency: ctx.currency,
    truncated,
  };
}

// ── Aggregates ───────────────────────────────────────────────────────────────

/**
 * Gets order counts by status for the dashboard.
 */
export async function getOrderStats(ctx: TenantContext) {
  requirePermission(ctx, 'order:read');

  return prisma.$transaction(async (tx) => {
    const [totalCount, byStatus, byPaymentStatus] = await Promise.all([
      tx.order.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
      tx.order.groupBy({
        by: ['status'],
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        _count: { _all: true },
      }),
      tx.order.groupBy({
        by: ['paymentStatus'],
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    return {
      total: totalCount,
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      byPaymentStatus: Object.fromEntries(
        byPaymentStatus.map((g) => [g.paymentStatus, g._count._all]),
      ),
    };
  });
}
