import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { OrderDetail } from '@/components/orders/order-detail';
import { getOrderDetail } from '@/server/services/order/order.service';
import type { TenantContext } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { orderId as orderIdSchema } from '@/server/validation/order';

type RouteParams = Promise<{ id: string }>;

/**
 * Loaded once per request. Next runs `generateMetadata` and the page in the same request and
 * both need the order; Prisma is not deduplicated the way `fetch` is, so without `cache` the
 * detail query — the order plus its items and its whole event history — would run twice.
 */
const loadOrder = cache(async (context: TenantContext, id: string) =>
  getOrderDetail(context, id),
);

/** The order number, so a tab full of orders is tellable apart without opening each one. */
export async function generateMetadata({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) return { title: 'Order' };

  const parsed = orderIdSchema.safeParse((await params).id);
  if (!parsed.success) return { title: 'Order not found' };

  const order = await loadOrder(context, parsed.data);
  return { title: order ? order.orderNumber : 'Order not found' };
}

/**
 * One order's page.
 *
 * The id comes from the path, and `getOrderDetail` scopes the read to the workspace in the
 * context — so an id belonging to another tenant returns null and lands here as a 404,
 * which is the same answer as an id that does not exist. Telling the two apart is exactly
 * what an id oracle is, and we do not build one.
 */
export default async function OrderDetailPage({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  // A malformed id is a 404, not a 500: without this the string reaches Prisma, which
  // rejects it as an invalid uuid and turns a mistyped URL into an error page.
  const parsed = orderIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const order = await loadOrder(context, parsed.data);
  if (!order) notFound();

  return <OrderDetail order={order} />;
}
