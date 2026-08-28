import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';

import { OrderStatusBadge, PaymentStatusBadge } from '@/components/orders/order-badges';
import { formatDate } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import type { OrderSummary } from '@/server/services/order/order.service';

/**
 * The order book.
 *
 * Rows, not a table, for the reason `ProductList` gives: an order's number, customer,
 * status, payment and total either scroll sideways on a phone or shrink past reading. Each
 * row is one link into the order, with the two figures a shop owner scans the book for —
 * the total and whether it is paid — held at the end where the eye lands.
 *
 * A server component: nothing here is interactive, so none of it ships as JavaScript.
 */
export function OrderList({ orders }: { orders: OrderSummary[] }) {
  return (
    <ul className="divide-y divide-border">
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
    </ul>
  );
}

/**
 * The secondary line: customer, item count and when it was placed, joined only when
 * present so a row never renders a dangling separator.
 */
function metaParts(order: OrderSummary): string[] {
  const parts: string[] = [];
  const customer = order.contactName ?? order.customerName;
  if (customer) parts.push(customer);
  parts.push(`${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`);
  parts.push(formatDate(order.createdAt));
  return parts;
}

function OrderRow({ order }: { order: OrderSummary }) {
  const meta = metaParts(order);

  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-6"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <ShoppingBag className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{order.orderNumber}</span>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">{meta.join(' · ')}</p>
        </div>

        <div className="flex flex-col items-end gap-1.5 text-end">
          <span className="font-medium text-foreground">{formatMoney(order.money.total)}</span>
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </Link>
    </li>
  );
}
