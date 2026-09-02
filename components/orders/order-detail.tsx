import { ArrowLeft, Ban, MessagesSquare } from 'lucide-react';
import Link from 'next/link';

import {
  FulfillmentStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/orders/order-badges';
import { OrderStatusActions } from '@/components/orders/order-status-actions';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import { formatMoney, type Money } from '@/lib/money';
import type {
  OrderDetail as OrderDetailData,
  OrderItemView,
} from '@/server/services/order/order.service';
import { PAYMENT_METHOD_LABELS } from '@/server/validation/order';

/**
 * One order, in full.
 *
 * The layout answers the three questions a shop owner opens an order to settle, in the order
 * they ask them: what is in it and what is it worth, where is it going and how are they
 * paying, and what has happened to it so far. The next step sits directly under the header,
 * because on most visits taking that step is the whole reason the page was opened.
 *
 * Facts appear once. The three states are chips beside the order number and nowhere else,
 * the total is at the foot of the items it totals, and the payment method — which has no
 * other home — sits with the customer it belongs to. A figure shown twice on one screen
 * reads as two figures that might disagree.
 *
 * A server component but for the status controls, which are the one interactive island.
 */
export function OrderDetail({ order }: { order: OrderDetailData }) {
  const address = [order.addressLine1, order.addressLine2, order.city, order.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        // The title is a code, so it needs saying what kind of thing it identifies. This is
        // the one screen in the product where the eyebrow earns its place: "Products" above
        // a product's name would only repeat what the name already tells you.
        eyebrow="Order"
        title={order.orderNumber}
        description={
          <>
            Placed {formatDateTime(order.placedAt)}
            {order.createdByAi ? ' · Taken by your AI' : ''}
          </>
        }
        badges={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <FulfillmentStatusBadge status={order.fulfillmentStatus} />
          </>
        }
        breadcrumb={
          // Pulled left by the button's own padding so the label lines up with the order
          // number below it rather than sitting a few pixels inside it.
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 self-start">
            <Link href="/orders">
              <ArrowLeft aria-hidden />
              All orders
            </Link>
          </Button>
        }
        actions={
          // Only for an order that came out of a chat. The inbox opens on the thread named
          // in the query string and falls back to the newest conversation if that thread has
          // since been closed away, so the link cannot dead-end.
          order.conversationId ? (
            <Button asChild variant="outline">
              <Link href={`/conversations?id=${order.conversationId}`}>
                <MessagesSquare aria-hidden />
                Open conversation
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Renders nothing when the order has reached a state with no legal next step, so
          there is no empty action bar on a delivered or cancelled order. */}
      <OrderStatusActions orderId={order.id} status={order.status} can={order.can} />

      {order.status === 'CANCELLED' ? (
        // Not a destructive surface. A cancellation is a decision someone made, not a
        // failure, and the reason is the first thing anyone asks a week later.
        <Alert>
          <Ban aria-hidden />
          <AlertTitle>
            This order was cancelled
            {order.cancelledAt ? ` on ${formatDateTime(order.cancelledAt)}` : ''}
          </AlertTitle>
          {order.cancelReason ? (
            <AlertDescription>{order.cancelReason}</AlertDescription>
          ) : (
            <AlertDescription>No reason was recorded.</AlertDescription>
          )}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Items</CardTitle>
              <CardDescription>
                Prices as they were when the order was placed, so changing a product&apos;s
                price later never changes what this customer owes.
              </CardDescription>
            </CardHeader>

            <TableContainer>
              <Table aria-label="Items in this order">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden md:table-cell" numeric>
                      Qty
                    </TableHead>
                    <TableHead className="hidden md:table-cell" numeric>
                      Unit price
                    </TableHead>
                    <TableHead numeric>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.itemViews.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* A receipt block, not a full-width table row: label and figure a screen apart
                is a pair the eye has to work to connect. `tfoot` was the other option and
                cannot work here, because the number of columns changes at `md` and a
                footer cell's `colSpan` cannot. */}
            <CardFooter className="flex-col items-stretch">
              <dl className="ml-auto flex w-full max-w-xs flex-col gap-1.5 text-sm">
                <TotalRow label="Subtotal" value={order.money.subtotal} />
                {order.money.discount.minor > 0 ? (
                  <TotalRow label="Discount" value={order.money.discount} negated />
                ) : null}
                {order.money.deliveryFee.minor > 0 ? (
                  <TotalRow label="Delivery" value={order.money.deliveryFee} />
                ) : null}
                {order.money.tax.minor > 0 ? (
                  <TotalRow label="Tax" value={order.money.tax} />
                ) : null}
                <TotalRow label="Total" value={order.money.total} emphasis />
              </dl>
            </CardFooter>
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
                <CardDescription>
                  Only your team can see these. The customer never does.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {order.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3.5 text-sm">
                <Field label="Name">
                  {/* Always a real customer record: an order cannot be written without one,
                      whether it came from a chat or was typed in by hand. */}
                  <Link
                    href={`/contacts/${order.contactId}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {order.contactName ?? order.customerName}
                  </Link>
                </Field>
                <Field label="Phone">
                  <span className="font-mono tabular-nums">{order.phoneE164}</span>
                </Field>
                <Field label="Delivering to">
                  {address ? (
                    address
                  ) : (
                    <span className="text-muted-foreground">No address recorded yet</span>
                  )}
                </Field>
                <Field label="Paying by">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline events={order.events} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One line of the order.
 *
 * Below `md` the quantity and unit price fold into the first cell as "2 × Rs 3,499", which
 * is how a shop owner says it out loud anyway. From `md` up each gets a column and the
 * folded line drops away, so nothing is drawn twice and nothing visible on a phone
 * disappears on a laptop.
 */
function ItemRow({ item }: { item: OrderItemView }) {
  const variant = [item.variantSnapshot, item.skuSnapshot].filter(Boolean).join(' · ');

  return (
    <TableRow>
      <TableCell>
        <span className="block font-medium text-foreground">{item.nameSnapshot}</span>
        {/* Absent for a product sold as a single item. A line reading "No variant" under
            every item in a one-size shop is noise, not information. */}
        {variant ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{variant}</span>
        ) : null}
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground md:hidden">
          {item.quantity} × {formatMoney(item.unitPrice)}
        </span>
      </TableCell>

      <TableCell className="hidden md:table-cell" numeric>
        {item.quantity}
      </TableCell>

      <TableCell className="hidden text-muted-foreground md:table-cell" numeric>
        {formatMoney(item.unitPrice)}
      </TableCell>

      <TableCell className="font-medium text-foreground" numeric>
        {formatMoney(item.lineSubtotal)}
      </TableCell>
    </TableRow>
  );
}

/**
 * One line of the totals. The rule above the last row is drawn by the row itself rather
 * than by a separator element, so a conditional line — discount, tax — cannot leave a
 * stray rule behind when it is absent.
 */
function TotalRow({
  label,
  value,
  negated,
  emphasis,
}: {
  label: string;
  value: Money;
  negated?: boolean;
  emphasis?: boolean;
}) {
  const amount = negated ? `− ${formatMoney(value)}` : formatMoney(value);

  return (
    <div
      className={
        emphasis
          ? 'mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-2.5'
          : 'flex items-baseline justify-between gap-4'
      }
    >
      <dt className={emphasis ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? 'font-mono text-base font-semibold tabular-nums text-foreground'
            : 'font-mono tabular-nums text-foreground'
        }
      >
        {amount}
      </dd>
    </div>
  );
}

/** A label above its value, for read-only detail. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
