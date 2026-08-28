/**
 * How an order's status, payment and fulfilment look.
 *
 * One module, for the reason `product-badges.tsx` gives: the same status vocabulary
 * appears on the orders list, the order page and the customer's order history, and a
 * colour that means "done" in one place and "waiting" in another is worse than no colour
 * at all.
 *
 * No `'use client'`: these are pure functions over their props, so they render on the
 * server and cost the browser nothing.
 */

import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  FULFILLMENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@/server/validation/order';

/**
 * Order status colour tracks where the order is in its life. A draft is a neutral
 * work-in-progress; the working states carry the app's primary colour; delivered is the
 * positive end; cancelled and its relatives are the ones that carry a warning or danger
 * tone because they need a human's attention.
 */
const STATUS_VARIANT: Record<OrderStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  PENDING: 'warning',
  CONFIRMED: 'default',
  PROCESSING: 'default',
  SHIPPED: 'secondary',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  RETURNED: 'warning',
  REFUNDED: 'muted',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

/**
 * Payment status is the money question a shop owner scans for: have I been paid? Paid is
 * positive, a failure is danger, and the in-between states carry the warning tone that
 * says "not settled yet".
 */
const PAYMENT_VARIANT: Record<PaymentStatus, BadgeProps['variant']> = {
  UNPAID: 'muted',
  PENDING: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  REFUNDED: 'muted',
  FAILED: 'danger',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={PAYMENT_VARIANT[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

/**
 * Fulfilment is about whether the goods have moved. Unfulfilled is quiet; the partial and
 * returned states warn; fulfilled is the positive end.
 */
const FULFILLMENT_VARIANT: Record<FulfillmentStatus, BadgeProps['variant']> = {
  UNFULFILLED: 'muted',
  PARTIALLY_FULFILLED: 'warning',
  FULFILLED: 'success',
  RETURNED: 'warning',
};

export function FulfillmentStatusBadge({ status }: { status: FulfillmentStatus }) {
  return <Badge variant={FULFILLMENT_VARIANT[status]}>{FULFILLMENT_STATUS_LABELS[status]}</Badge>;
}
