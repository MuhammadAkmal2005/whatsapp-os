import { describe, expect, it } from 'vitest';

import { formatMoney } from '@/lib/money';
import { resolvePrice } from '@/server/services/product/pricing';

/**
 * The price a customer is quoted.
 *
 * Worth its own suite because this is the figure that reaches a customer over WhatsApp and
 * then has to match the figure on the order. Four callers ask this question — the
 * catalogue, the product page, the AI's `get_product` tool and `create_order` — and the
 * cost of them disagreeing is a customer told Rs. 3,499 and charged Rs. 3,999.
 *
 * Every amount here is integer minor units. Rs. 3,499 is 349900 paisa.
 */

const KURTA = { priceMinor: 349_900, salePriceMinor: null, currency: 'PKR' };
const KURTA_ON_SALE = { priceMinor: 349_900, salePriceMinor: 299_900, currency: 'PKR' };

describe('a product with no variant', () => {
  it('charges the normal price when there is no sale', () => {
    const price = resolvePrice(KURTA);
    expect(price.effective.minor).toBe(349_900);
    expect(price.list.minor).toBe(349_900);
    expect(price.isDiscounted).toBe(false);
  });

  it('charges the sale price when there is one', () => {
    const price = resolvePrice(KURTA_ON_SALE);
    expect(price.effective.minor).toBe(299_900);
    expect(price.list.minor).toBe(349_900);
    expect(price.isDiscounted).toBe(true);
  });

  it('carries the product currency onto both amounts', () => {
    const price = resolvePrice({ priceMinor: 12_500, salePriceMinor: null, currency: 'AED' });
    expect(price.effective.currency).toBe('AED');
    expect(price.list.currency).toBe('AED');
  });

  /** A shop owner reads this string back to a customer. Whole rupees drop the decimals,
   *  which is how Pakistani retail prices are written and read aloud. */
  it('formats to the figure a customer is quoted', () => {
    expect(formatMoney(resolvePrice(KURTA).effective)).toBe('Rs. 3,499');
  });
});

describe('a variant that inherits', () => {
  const NO_OVERRIDE = { priceMinor: null, salePriceMinor: null };

  it('takes the product price', () => {
    expect(resolvePrice(KURTA, NO_OVERRIDE).effective.minor).toBe(349_900);
  });

  /** The common case in a real shop: the style is on sale, and every size is on sale. */
  it('takes the product sale price too', () => {
    const price = resolvePrice(KURTA_ON_SALE, NO_OVERRIDE);
    expect(price.effective.minor).toBe(299_900);
    expect(price.isDiscounted).toBe(true);
  });
});

describe('a variant that overrides', () => {
  it('charges its own price instead of the product price', () => {
    const price = resolvePrice(KURTA, { priceMinor: 399_900, salePriceMinor: null });
    expect(price.effective.minor).toBe(399_900);
    expect(price.list.minor).toBe(399_900);
    expect(price.isDiscounted).toBe(false);
  });

  it('discounts the product price when it sets only a sale price', () => {
    const price = resolvePrice(KURTA, { priceMinor: null, salePriceMinor: 299_900 });
    expect(price.effective.minor).toBe(299_900);
    expect(price.list.minor).toBe(349_900);
    expect(price.isDiscounted).toBe(true);
  });

  it('discounts its own price when it sets both', () => {
    const price = resolvePrice(KURTA, { priceMinor: 399_900, salePriceMinor: 349_900 });
    expect(price.effective.minor).toBe(349_900);
    expect(price.list.minor).toBe(399_900);
    expect(price.isDiscounted).toBe(true);
  });

  /**
   * The rule the module exists to hold. An XL priced at Rs. 2,500 must not inherit the
   * product's Rs. 2,999 sale price — that is a "sale" above what the customer pays, shown
   * as a saving, on a price the shop never set. An `?? product.salePriceMinor` written
   * without this case in mind produces exactly that.
   */
  it('does not inherit the product sale price on top of its own price', () => {
    const price = resolvePrice(
      { priceMinor: 349_900, salePriceMinor: 299_900, currency: 'PKR' },
      { priceMinor: 250_000, salePriceMinor: null },
    );
    expect(price.effective.minor).toBe(250_000);
    expect(price.list.minor).toBe(250_000);
    expect(price.isDiscounted).toBe(false);
  });
});

describe('data that should not display as a discount', () => {
  /**
   * The service refuses to store a sale price at or above the normal price, and the schema
   * refuses to accept one. This is the third line: rows written before that rule existed,
   * or by a path that forgets it, must not advertise a saving of nothing.
   */
  it('ignores a sale price equal to the normal price', () => {
    const price = resolvePrice({ priceMinor: 349_900, salePriceMinor: 349_900, currency: 'PKR' });
    expect(price.effective.minor).toBe(349_900);
    expect(price.isDiscounted).toBe(false);
  });

  it('ignores a sale price above the normal price', () => {
    const price = resolvePrice({ priceMinor: 349_900, salePriceMinor: 399_900, currency: 'PKR' });
    expect(price.effective.minor).toBe(349_900);
    expect(price.isDiscounted).toBe(false);
  });

  /** An unrecognised currency code coerces to the default rather than throwing, because a
   *  price that cannot render turns a catalogue page into an error boundary. */
  it('falls back to a supported currency rather than throwing', () => {
    expect(() =>
      resolvePrice({ priceMinor: 349_900, salePriceMinor: null, currency: 'XYZ' }),
    ).not.toThrow();
  });
});

describe('the free product', () => {
  /** Zero is a real price — a sample, or a replacement sent after a complaint — and must
   *  not be confused with "no price set". */
  it('treats zero as a price rather than as missing', () => {
    const price = resolvePrice({ priceMinor: 0, salePriceMinor: null, currency: 'PKR' });
    expect(price.effective.minor).toBe(0);
    expect(price.isDiscounted).toBe(false);
  });
});
