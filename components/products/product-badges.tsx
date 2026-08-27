/**
 * How a product's status, stock level and price look.
 *
 * One module, for the reason `contact-badges.tsx` gives: the same vocabulary appears on
 * the catalogue list, the product page and — soon — the order builder, and a colour that
 * means "fine" in one place and "reorder now" in another is worse than no colour at all.
 *
 * No `'use client'`: these are pure functions over their props, so they render on the
 * server and cost the browser nothing.
 */

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ResolvedPrice } from '@/server/services/product/pricing';
import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@/server/validation/product';

/**
 * Status is about whether the AI may sell the thing, so the colour tracks that: active is
 * positive, a draft is a neutral work-in-progress, archived is quietly out of the way.
 */
const STATUS_VARIANT: Record<ProductStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  ARCHIVED: 'outline',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{PRODUCT_STATUS_LABELS[status]}</Badge>;
}

/**
 * The one number a shop owner scans a catalogue for: am I about to run out?
 *
 * The four states are distinct on purpose. "Out of stock" and "Low stock" are the two
 * that need action and so carry colour; "In stock" is reassurance; "Not tracked" is for a
 * made-to-order item that has no shelf to count, and it must not read as a fault — a
 * warning colour there would train the reader to ignore the badge.
 */
export function StockBadge({
  tracksStock,
  totalAvailable,
  isLowStock,
}: {
  tracksStock: boolean;
  totalAvailable: number;
  isLowStock: boolean;
}) {
  if (!tracksStock) return <Badge variant="muted">Not tracked</Badge>;
  if (totalAvailable <= 0) return <Badge variant="danger">Out of stock</Badge>;
  if (isLowStock) {
    return <Badge variant="warning">{`Low · ${totalAvailable} left`}</Badge>;
  }
  return <Badge variant="success">{`${totalAvailable} in stock`}</Badge>;
}

/**
 * A price, with the normal price struck through when there is a sale.
 *
 * Takes a `ResolvedPrice` rather than raw minor units so the sale logic lives in exactly
 * one place — `resolvePrice` — and a page can never disagree with the order builder about
 * what a thing costs. `isDiscounted` is already computed there, including the guard that a
 * sale price equal to the normal price is not a saving.
 */
export function ProductPrice({
  price,
  className,
}: {
  price: ResolvedPrice;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span className="font-medium text-foreground">{formatMoney(price.effective)}</span>
      {price.isDiscounted ? (
        <span className="text-sm text-muted-foreground line-through">
          {formatMoney(price.list)}
        </span>
      ) : null}
    </span>
  );
}
