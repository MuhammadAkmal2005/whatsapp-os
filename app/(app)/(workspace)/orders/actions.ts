/**
 * Order server actions.
 *
 * These are the Next.js server actions that back the orders UI. Each one resolves
 * the tenant context, validates its input with the shared Zod schema, calls the
 * service, and returns a discriminated union result.
 */

'use server';

import { revalidatePath } from 'next/cache';

import {
  cancelOrder as cancelOrderService,
  createOrder as createOrderService,
  getOrderDetail as getOrderDetailService,
  getOrderByNumber as getOrderByNumberService,
  listOrders as listOrdersService,
  updateOrder as updateOrderService,
  updateOrderStatus as updateOrderStatusService,
  getOrderStats as getOrderStatsService,
} from '@/server/services/order/order.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  cancelOrderSchema,
  createOrderSchema,
  orderFiltersSchema,
  updateOrderSchema,
  updateOrderStatusSchema,
  type CancelOrderInput,
  type CreateOrderInput,
  type OrderFiltersInput,
  type UpdateOrderInput,
  type UpdateOrderStatusInput,
} from '@/server/validation/order';

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Creates a new order.
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<ActionResult<{ orderId: string; orderNumber: string }>> {
  try {
    const ctx = await requireTenantContext();
    const validated = createOrderSchema.parse(input);
    const order = await createOrderService(ctx, validated);

    revalidatePath('/orders');
    revalidatePath(`/contacts/${order.contactId}`);

    return { ok: true, data: { orderId: order.id, orderNumber: order.orderNumber } };
  } catch (error) {
    console.error('createOrder error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create order',
    };
  }
}

/**
 * Updates an order's mutable fields.
 */
export async function updateOrder(
  orderId: string,
  input: UpdateOrderInput,
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireTenantContext();
    const validated = updateOrderSchema.parse(input);
    await updateOrderService(ctx, orderId, validated);

    revalidatePath('/orders');
    revalidatePath(`/orders/${orderId}`);

    return { ok: true, data: undefined };
  } catch (error) {
    console.error('updateOrder error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update order',
    };
  }
}

/**
 * Updates an order's status.
 */
export async function updateOrderStatus(
  orderId: string,
  input: UpdateOrderStatusInput,
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireTenantContext();
    const validated = updateOrderStatusSchema.parse(input);
    const order = await updateOrderStatusService(ctx, orderId, validated);

    revalidatePath('/orders');
    revalidatePath(`/orders/${orderId}`);
    revalidatePath(`/contacts/${order.contactId}`);

    return { ok: true, data: undefined };
  } catch (error) {
    console.error('updateOrderStatus error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update order status',
    };
  }
}

/**
 * Cancels an order.
 */
export async function cancelOrder(
  orderId: string,
  input: CancelOrderInput,
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireTenantContext();
    const validated = cancelOrderSchema.parse(input);
    const order = await cancelOrderService(ctx, orderId, validated);

    revalidatePath('/orders');
    revalidatePath(`/orders/${orderId}`);
    revalidatePath(`/contacts/${order.contactId}`);

    return { ok: true, data: undefined };
  } catch (error) {
    console.error('cancelOrder error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to cancel order',
    };
  }
}

/**
 * Lists orders with filters.
 */
export async function listOrders(filters: OrderFiltersInput) {
  try {
    const ctx = await requireTenantContext();
    const validated = orderFiltersSchema.parse(filters);
    const result = await listOrdersService(ctx, validated);

    return { ok: true, data: result };
  } catch (error) {
    console.error('listOrders error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to list orders',
    };
  }
}

/**
 * Gets a single order by ID.
 */
export async function getOrderDetail(orderId: string) {
  try {
    const ctx = await requireTenantContext();
    const order = await getOrderDetailService(ctx, orderId);

    if (!order) {
      return { ok: false, error: 'Order not found' };
    }

    return { ok: true, data: order };
  } catch (error) {
    console.error('getOrderDetail error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to get order',
    };
  }
}

/**
 * Gets an order by its order number.
 */
export async function getOrderByNumber(orderNumber: string) {
  try {
    const ctx = await requireTenantContext();
    const order = await getOrderByNumberService(ctx, orderNumber);

    if (!order) {
      return { ok: false, error: 'Order not found' };
    }

    return { ok: true, data: order };
  } catch (error) {
    console.error('getOrderByNumber error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to get order',
    };
  }
}

/**
 * Gets order statistics for the dashboard.
 */
export async function getOrderStats() {
  try {
    const ctx = await requireTenantContext();
    const stats = await getOrderStatsService(ctx);

    return { ok: true, data: stats };
  } catch (error) {
    console.error('getOrderStats error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to get order stats',
    };
  }
}
