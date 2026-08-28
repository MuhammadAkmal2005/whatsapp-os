import { ArrowLeft, Bot, MapPin, Phone, User } from 'lucide-react';
import Link from 'next/link';

import {
  FulfillmentStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/orders/order-badges';
import { OrderStatusActions } from '@/components/orders/order-status-actions';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatDateTime } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import type { OrderDetail as OrderDetailData } from '@/server/services/order/order.service';
import { PAYMENT_METHOD_LABELS } from '@/server/validation/order';

/**
 * One order, in full.
 *
 * The layout answers the three questions a shop owner opens an order to settle, in the
 * order they ask them: what is in it and what is it worth (the items and totals), where is
 * it going and how are they paying (the customer panel), and what has happened to it so far
 * (the timeline). The status controls sit at the top, where the next action belongs.
 *
 * A server component but for the status controls, which are the one interactive island.
 */
export function OrderDetail({ order }: { order: OrderDetailData }) {
  const addressParts = [
    order.addressLine1,
    order.addressLine2,
    order.city,
    order.postalCode,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/orders"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to orders
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {order.orderNumber}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <PaymentStatusBadge status={order.paymentStatus} />
              <FulfillmentStatusBadge status={order.fulfillmentStatus} />
              {order.createdByAi ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="size-3.5" aria-hidden />
                  Created by AI
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">Placed {formatDateTime(order.placedAt)}</p>
          </div>
        </div>

        <OrderStatusActions orderId={order.id} status={order.status} can={order.can} />

        {order.status === 'CANCELLED' && order.cancelReason ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Cancelled:</span> {order.cancelReason}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0 p-0">
              <ul className="divide-y divide-border">
                {order.itemViews.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-6 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{item.nameSnapshot}</p>
                      <p className="text-sm text-muted-foreground">
                        {[item.variantSnapshot, item.skuSnapshot].filter(Boolean).join(' · ') ||
                          'No variant'}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {item.quantity} × {formatMoney(item.unitPrice)}
                      </p>
                    </div>
                    <span className="font-medium text-foreground">
                      {formatMoney(item.lineSubtotal)}
                    </span>
                  </li>
                ))}
              </ul>

              <Separator />

              <dl className="flex flex-col gap-2 px-6 py-4 text-sm">
                <TotalRow label="Subtotal" value={formatMoney(order.money.subtotal)} />
                {order.money.discount.minor > 0 ? (
                  <TotalRow label="Discount" value={`− ${formatMoney(order.money.discount)}`} />
                ) : null}
                {order.money.deliveryFee.minor > 0 ? (
                  <TotalRow label="Delivery" value={formatMoney(order.money.deliveryFee)} />
                ) : null}
                {order.money.tax.minor > 0 ? (
                  <TotalRow label="Tax" value={formatMoney(order.money.tax)} />
                ) : null}
                <Separator className="my-1" />
                <div className="flex items-center justify-between">
                  <dt className="text-base font-semibold text-foreground">Total</dt>
                  <dd className="text-base font-semibold text-foreground">
                    {formatMoney(order.money.total)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{order.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={`/contacts/${order.contactId}`} className="font-medium text-foreground hover:underline">
                  {order.contactName ?? order.customerName}
                </Link>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-4 shrink-0" aria-hidden />
                <span>{order.phoneE164}</span>
              </div>
              {addressParts.length > 0 ? (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{addressParts.join(', ')}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="font-medium text-foreground">
                  {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
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

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
