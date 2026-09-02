import Link from 'next/link';

import { OrderStatusBadge, PaymentStatusBadge } from '@/components/orders/order-badges';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import type { OrderSummary } from '@/server/services/order/order.service';

/**
 * The order book.
 *
 * A table, for the reason given in `product-list.tsx`: this screen exists to be read down
 * its columns — which orders are unpaid, which totals are large, which have not moved — and
 * stacked rows put every figure at a different horizontal position, which turns looking into
 * reading.
 *
 * Below `md` two columns are drawn, the order and its total, with the customer and the date
 * folded into the first cell and the two states shown as chips beneath. From `md` up the
 * customer, date, status and payment each get a column and the folded line drops away, so no
 * fact is drawn twice and nothing visible on a phone disappears on a laptop. The item count
 * stays in the first cell as a quiet second line, the same place a product's size count sits:
 * it qualifies the order rather than being a figure anyone reconciles a day's takings against.
 *
 * A server component: nothing here is interactive, so none of it ships as JavaScript.
 */
export function OrderList({ orders }: { orders: OrderSummary[] }) {
  return (
    <TableContainer>
      <Table aria-label="Orders">
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead className="hidden md:table-cell">Customer</TableHead>
            <TableHead className="hidden md:table-cell">Placed</TableHead>
            <TableHead numeric>Total</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="hidden md:table-cell">Payment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  // An order taken over WhatsApp is linked to a contact; one written up by hand may carry
  // only a typed name. Either is the customer as far as this screen is concerned.
  const customer = order.contactName ?? order.customerName;
  const placedOn = formatDate(order.createdAt);
  const items = `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`;

  return (
    // `relative` so the order number's stretched overlay covers this row and nothing wider.
    <TableRow interactive className="relative">
      <TableCell>
        <Link
          href={`/orders/${order.id}`}
          className="font-mono font-medium text-foreground after:absolute after:inset-0 after:content-['']"
        >
          {order.orderNumber}
        </Link>

        <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
          {customer ? `${customer} · ${placedOn} · ${items}` : `${placedOn} · ${items}`}
        </span>
        <span className="mt-0.5 hidden text-xs text-muted-foreground md:block">{items}</span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
        </span>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        {customer ?? <span className="text-muted-foreground">No name recorded</span>}
      </TableCell>

      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
        {placedOn}
      </TableCell>

      <TableCell className="font-medium text-foreground" numeric>
        {formatMoney(order.money.total)}
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <OrderStatusBadge status={order.status} />
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <PaymentStatusBadge status={order.paymentStatus} />
      </TableCell>
    </TableRow>
  );
}
