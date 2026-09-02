/**
 * Validation schemas for orders.
 *
 * Order totals are computed server-side from database prices and are **never** trusted
 * from the client or from a model. The schemas here validate structure and business
 * constraints, but the arithmetic happens in the order service.
 *
 * Prices arrive as strings for the same reasons documented in `product.ts`: currency
 * depends on the workspace, floats are forbidden, and a shop owner types `Rs. 3,499`.
 */

import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';

const CUSTOMER_NAME_MAX = 140;
const ADDRESS_LINE_MAX = 200;
const CITY_MAX = 100;
const POSTAL_CODE_MAX = 20;
const COUNTRY_CODE_MAX = 2;
const NOTES_MAX = 1000;
const CANCEL_REASON_MAX = 500;
const COURIER_NAME_MAX = 100;
const TRACKING_NUMBER_MAX = 100;
const SEARCH_MAX = 80;

/** The same limits the schemas enforce, exported for the forms' `maxLength`. */
export const ORDER_FIELD_MAX = {
  customerName: CUSTOMER_NAME_MAX,
  addressLine: ADDRESS_LINE_MAX,
  city: CITY_MAX,
  postalCode: POSTAL_CODE_MAX,
  notes: NOTES_MAX,
  cancelReason: CANCEL_REASON_MAX,
  courierName: COURIER_NAME_MAX,
  trackingNumber: TRACKING_NUMBER_MAX,
  search: SEARCH_MAX,
} as const;

const QUANTITY_MAX = 1_000_000;

/** E.164 phone number validation - matches pattern from contact validation. */
const phoneE164Schema = z
  .string()
  .trim()
  .min(1, 'Phone number is required.')
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +923001234567).');

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'UNPAID',
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'REFUNDED',
  'FAILED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'RETURNED',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'COD',
  'BANK_TRANSFER',
  'JAZZCASH',
  'EASYPAISA',
  'CARD',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Guards a route parameter before it reaches Prisma, which rejects a non-uuid as a driver
 *  error — turning a mistyped URL into an error page instead of a not-found page. */
export const orderId = z.string().uuid('That order reference is not valid.');

/** An item in the order creation request. The service resolves product/variant to
 *  the current price and snapshots the name and SKU. */
export const createOrderItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  quantity: z.number().int().min(1).max(QUANTITY_MAX),
});

export type CreateOrderItemInput = z.infer<typeof createOrderItemSchema>;

/**
 * Order creation input.
 *
 * The client supplies contact, items, delivery address and payment method. The
 * server derives everything else: prices from the database, totals from the prices,
 * snapshots from the product rows.
 */
export const createOrderSchema = z.object({
  contactId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  items: z.array(createOrderItemSchema).min(1).max(100),

  // Delivery address
  customerName: z.string().min(1).max(CUSTOMER_NAME_MAX),
  phoneE164: phoneE164Schema,
  addressLine1: z.string().max(ADDRESS_LINE_MAX).nullable().optional(),
  addressLine2: z.string().max(ADDRESS_LINE_MAX).nullable().optional(),
  city: z.string().max(CITY_MAX).nullable().optional(),
  postalCode: z.string().max(POSTAL_CODE_MAX).nullable().optional(),
  country: z.string().length(COUNTRY_CODE_MAX).default('PK'),

  paymentMethod: z.enum(PAYMENT_METHODS).default('COD'),
  notes: z.string().max(NOTES_MAX).nullable().optional(),

  // Optional overrides for server-calculated values, used only when a human explicitly
  // sets them in the dashboard. Never honored from an AI-created order.
  discountMinor: z.number().int().min(0).optional(),
  deliveryFeeMinor: z.number().int().min(0).optional(),
  taxMinor: z.number().int().min(0).optional(),

  idempotencyKey: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Order update input. Most fields are immutable after creation; these are the ones
 *  a business may edit. */
export const updateOrderSchema = z.object({
  customerName: z.string().min(1).max(CUSTOMER_NAME_MAX).optional(),
  phoneE164: phoneE164Schema.optional(),
  addressLine1: z.string().max(ADDRESS_LINE_MAX).nullable().optional(),
  addressLine2: z.string().max(ADDRESS_LINE_MAX).nullable().optional(),
  city: z.string().max(CITY_MAX).nullable().optional(),
  postalCode: z.string().max(POSTAL_CODE_MAX).nullable().optional(),
  country: z.string().length(COUNTRY_CODE_MAX).optional(),
  notes: z.string().max(NOTES_MAX).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  courierName: z.string().max(COURIER_NAME_MAX).nullable().optional(),
  trackingNumber: z.string().max(TRACKING_NUMBER_MAX).nullable().optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

/** Status transition input. The service validates that the transition is legal. */
export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().max(NOTES_MAX).nullable().optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/** Cancellation input. */
export const cancelOrderSchema = z.object({
  reason: z.string().min(1).max(CANCEL_REASON_MAX),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** Order list filters. */
export const orderFiltersSchema = z.object({
  search: z.string().max(SEARCH_MAX).nullable().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
  contactId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type OrderFiltersInput = z.infer<typeof orderFiltersSchema>;

/**
 * Legal order status transitions.
 *
 * Monotonic where it matters: a delivered order cannot go back to pending, because
 * the contact aggregates and analytics already counted it. A cancelled order stays
 * cancelled because the inventory was already released.
 */
export const LEGAL_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED', 'REFUNDED'],
  CANCELLED: [],
  RETURNED: ['REFUNDED'],
  REFUNDED: [],
};

/**
 * Whether the transition from `from` to `to` is legal.
 */
export function isLegalStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return LEGAL_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Terminal statuses — orders that will never transition again.
 */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ── Display labels ───────────────────────────────────────────────────────────
//
// One place for the words a shop owner reads, co-located with the enums so a new
// status cannot be added without the type error that reminds you to name it. The
// UI never hard-codes these strings; the dashboard is English today and moves to
// the localisation layer later.

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
};

/** The consequence of each status, phrased for the shop owner rather than the schema. */
export const ORDER_STATUS_DESCRIPTIONS: Record<OrderStatus, string> = {
  DRAFT: 'Not placed yet. You can still edit the items and totals.',
  PENDING: 'Placed and waiting for you to confirm.',
  CONFIRMED: 'You have confirmed the order. Stock stays reserved.',
  PROCESSING: 'Being packed and prepared for dispatch.',
  SHIPPED: 'Handed to the courier and on its way.',
  DELIVERED: 'Delivered to the customer. Stock is counted as sold.',
  CANCELLED: 'Cancelled. Reserved stock has been returned to available.',
  RETURNED: 'Sent back by the customer.',
  REFUNDED: 'Money returned to the customer.',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PENDING: 'Payment pending',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  FAILED: 'Payment failed',
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  UNFULFILLED: 'Unfulfilled',
  PARTIALLY_FULFILLED: 'Partially fulfilled',
  FULFILLED: 'Fulfilled',
  RETURNED: 'Returned',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  COD: 'Cash on delivery',
  BANK_TRANSFER: 'Bank transfer',
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'Easypaisa',
  CARD: 'Card',
  OTHER: 'Other',
};
