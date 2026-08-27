/**
 * What a product or one of its variants actually costs.
 *
 * A pure module with no database and no context, for one reason: the same question gets
 * asked from four places — the catalogue list, the product page, the AI's `get_product`
 * tool and `create_order` — and the answer has to be identical every time. A customer
 * quoted Rs. 3,499 in chat and charged Rs. 3,999 at checkout is the kind of defect that
 * ends a business's trust in the product, and it is exactly what four inlined `??`
 * expressions produce once one of them is edited.
 *
 * Two prices, and the distinction is what a shop owner sees on their own page:
 *
 *   list price       — the normal price, shown struck through when there is a sale.
 *   effective price  — what the customer pays. The only figure an order may use.
 *
 * The inheritance rule is the non-obvious part. A variant's `priceMinor` and
 * `salePriceMinor` are both overrides, but they do not inherit independently:
 *
 *   - Variant sets neither → the product's price and the product's sale apply. This is
 *     the common case, a size that costs the same as everything else.
 *   - Variant sets `salePriceMinor` only → it discounts the *product's* price. "XL is
 *     Rs. 500 off this week."
 *   - Variant sets `priceMinor` → that price governs, and the product's sale price is
 *     **not** inherited on top of it. Inheriting would let a product-wide discount of
 *     Rs. 3,000 attach to a variant priced at Rs. 2,500 and produce a sale price above
 *     the list price — a negative discount, displayed as a saving.
 */

import { coerceCurrency, money, type Money } from '@/lib/money';

/** The price-carrying subset of a product row. Structural rather than the full
 *  `ProductRow`, so the AI tools and the order service can pass their own shapes. */
export type PricedProduct = {
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
};

/** The price-carrying subset of a variant row. Both nullable — null means "inherit". */
export type PricedVariant = {
  priceMinor: number | null;
  salePriceMinor: number | null;
};

export type ResolvedPrice = {
  /** What the customer pays. */
  effective: Money;
  /** The normal price. Equal to `effective` when nothing is on sale. */
  list: Money;
  /** Whether to show the list price struck through. Derived rather than stored, so a
   *  sale price mistakenly equal to the normal price does not advertise a saving. */
  isDiscounted: boolean;
};

export function resolvePrice(
  product: PricedProduct,
  variant: PricedVariant | null = null,
): ResolvedPrice {
  const currency = coerceCurrency(product.currency);

  const overrideMinor = variant?.priceMinor ?? null;
  const listMinor = overrideMinor ?? product.priceMinor;

  // The sale price is read from the same source as the list price it discounts. See the
  // module note: a variant with its own price does not inherit the product's sale.
  const saleMinor =
    overrideMinor === null
      ? (variant?.salePriceMinor ?? product.salePriceMinor)
      : (variant?.salePriceMinor ?? null);

  // A sale price at or above the list price is not a sale. The service refuses to store
  // one, and this is the second line of defence: data written before that rule existed,
  // or by a future path that forgets it, must not display as a discount.
  const isDiscounted = saleMinor !== null && saleMinor < listMinor;

  return {
    effective: money(isDiscounted && saleMinor !== null ? saleMinor : listMinor, currency),
    list: money(listMinor, currency),
    isDiscounted,
  };
}
