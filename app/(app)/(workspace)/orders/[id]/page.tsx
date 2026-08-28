import { notFound, redirect } from 'next/navigation';

import { OrderDetail } from '@/components/orders/order-detail';
import { getOrderDetail } from '@/server/services/order/order.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'Order' };

/**
 * One order's page.
 *
 * The id comes from the path, and `getOrderDetail` scopes the read to the workspace in the
 * context — so an id belonging to another tenant returns null and lands here as a 404,
 * which is the same answer as an id that does not exist. Telling the two apart is exactly
 * what an id oracle is, and we do not build one.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const { id } = await params;
  const order = await getOrderDetail(context, id);
  if (!order) notFound();

  return <OrderDetail order={order} />;
}
