import { describe, expect, it } from 'vitest';

import { formatMoney, fromMajor, money, MoneyError, parseMoney } from '@/lib/money';
import { BusinessRuleError } from '@/server/errors';
import { computeOrderTotals, totalsMatch } from '@/server/domain/order-totals';

const PKR = (minor: number) => money(minor, 'PKR');

describe('critical order acceptance test (instruction #98)', () => {
  /**
   * Rs. 3,499 × 2 + Rs. 250 delivery must be exactly Rs. 7,248. Stated as an
   * acceptance criterion because a floating-point implementation gets it wrong by
   * a paisa often enough to matter, and because the AI must never be the thing
   * that computes it.
   */
  it('prices 2 × Rs. 3,499 plus Rs. 250 delivery at Rs. 7,248', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(3499, 'PKR'), quantity: 2 }],
      deliveryFee: fromMajor(250, 'PKR'),
    });

    expect(totals.subtotal.minor).toBe(699_800);
    expect(totals.deliveryFee.minor).toBe(25_000);
    expect(totals.tax.minor).toBe(0);
    expect(totals.total.minor).toBe(724_800);
    expect(formatMoney(totals.total)).toBe('Rs. 7,248');
  });

  it('agrees with the persisted total', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(3499, 'PKR'), quantity: 2 }],
      deliveryFee: fromMajor(250, 'PKR'),
    });
    expect(totalsMatch(totals, 724_800)).toBe(true);
    // The check that stops a payment being captured against a mutated order.
    expect(totalsMatch(totals, 724_700)).toBe(false);
  });
});

describe('money primitives', () => {
  it('rejects a fractional minor unit', () => {
    expect(() => money(10.5, 'PKR')).toThrow(MoneyError);
  });

  it('converts major units without floating-point drift', () => {
    expect(fromMajor(3499, 'PKR').minor).toBe(349_900);
    expect(fromMajor(0.1, 'USD').minor).toBe(10);
    expect(fromMajor(1.25, 'USD').minor).toBe(125);
    expect(fromMajor(-1.25, 'USD').minor).toBe(-125);
  });

  /**
   * Sub-paisa values expose the limit of the input type, not of the rounding rule.
   * `1.005 * 100` lands just below the tie and rounds down; `2.675 * 100` lands
   * exactly on it and rounds up. Which one happens depends on where the value sits
   * relative to the nearest double, so it cannot be reasoned about per-value.
   *
   * This is the whole reason user-typed prices go through `parseMoney`, which reads
   * the decimal string exactly, and why every price in the database is already an
   * integer by the time any arithmetic touches it.
   */
  it('rounds symmetrically, and documents the float tie caveat', () => {
    expect(fromMajor(1.005, 'USD').minor).toBe(100);
    expect(fromMajor(-1.005, 'USD').minor).toBe(-100);
    expect(fromMajor(2.675, 'USD').minor).toBe(268);
    expect(fromMajor(-2.675, 'USD').minor).toBe(-268);
    // The string path is exact and is what production input uses.
    expect(parseMoney('1.00', 'USD')?.minor).toBe(100);
    expect(parseMoney('2.67', 'USD')?.minor).toBe(267);
  });

  it('formats PKR without decimals when the amount is whole', () => {
    expect(formatMoney(PKR(349_900))).toBe('Rs. 3,499');
    expect(formatMoney(PKR(349_950))).toBe('Rs. 3,499.50');
  });

  it('parses the ways a shop owner actually types a price', () => {
    expect(parseMoney('3499', 'PKR')?.minor).toBe(349_900);
    expect(parseMoney('3,499', 'PKR')?.minor).toBe(349_900);
    expect(parseMoney('Rs. 3499', 'PKR')?.minor).toBe(349_900);
    expect(parseMoney('3499.50', 'PKR')?.minor).toBe(349_950);
  });

  it('returns null rather than throwing on unparseable input', () => {
    expect(parseMoney('', 'PKR')).toBeNull();
    expect(parseMoney('abc', 'PKR')).toBeNull();
    expect(parseMoney('10.999', 'PKR')).toBeNull();
  });
});

describe('order totals', () => {
  it('sums multiple lines', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [
        { unitPrice: fromMajor(3499, 'PKR'), quantity: 2 },
        { unitPrice: fromMajor(1299, 'PKR'), quantity: 1 },
        { unitPrice: fromMajor(899, 'PKR'), quantity: 3 },
      ],
      deliveryFee: fromMajor(250, 'PKR'),
    });

    // 6998 + 1299 + 2697 = 10994, + 250 = 11244
    expect(totals.subtotal.minor).toBe(1_099_400);
    expect(totals.total.minor).toBe(1_124_400);
  });

  it('applies a per-line discount before the order discount', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [
        { unitPrice: fromMajor(3499, 'PKR'), quantity: 2, discount: fromMajor(499, 'PKR') },
      ],
      discount: fromMajor(500, 'PKR'),
      deliveryFee: fromMajor(250, 'PKR'),
    });

    // 6998 − 499 = 6499 subtotal; − 500 order discount = 5999; + 250 = 6249
    expect(totals.subtotal.minor).toBe(649_900);
    expect(totals.discount.minor).toBe(99_900);
    expect(totals.total.minor).toBe(624_900);
  });

  it('adds exclusive tax to goods and delivery', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1000, 'PKR'), quantity: 1 }],
      deliveryFee: fromMajor(200, 'PKR'),
      taxBasisPoints: 1700,
    });

    // 1200 × 17% = 204
    expect(totals.tax.minor).toBe(20_400);
    expect(totals.total.minor).toBe(140_400);
  });

  it('extracts inclusive tax without changing the total', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1170, 'PKR'), quantity: 1 }],
      taxBasisPoints: 1700,
      taxInclusive: true,
    });

    // The marked price is what the customer pays; tax is 1170 × 1700 / 11700 = 170
    expect(totals.total.minor).toBe(117_000);
    expect(totals.tax.minor).toBe(17_000);
  });

  it('floors goods at zero for an over-large order discount but still charges delivery', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(500, 'PKR'), quantity: 1 }],
      discount: fromMajor(900, 'PKR'),
      deliveryFee: fromMajor(250, 'PKR'),
    });

    expect(totals.total.minor).toBe(25_000);
    // Only the discount that was actually usable is reported, not the 900 asked for.
    expect(totals.discount.minor).toBe(50_000);
  });

  it('never produces a negative total', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(100, 'PKR'), quantity: 1 }],
      discount: fromMajor(10_000, 'PKR'),
    });
    expect(totals.total.minor).toBe(0);
  });

  it('charges no tax at a zero rate, and no delivery at a zero fee', () => {
    // The state most workspaces are actually in: the owner has filled in nothing, so the
    // order is the goods and nothing else. This has to be exactly right, because it is
    // the default every business starts from.
    const both = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1499, 'PKR'), quantity: 1 }],
      deliveryFee: PKR(0),
      taxBasisPoints: 0,
    });

    expect(both.deliveryFee.minor).toBe(0);
    expect(both.tax.minor).toBe(0);
    expect(both.total.minor).toBe(149_900);

    // Omitting the fields entirely is the same statement as passing zero.
    const omitted = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1499, 'PKR'), quantity: 1 }],
    });
    expect(omitted.deliveryFee.minor).toBe(0);
    expect(omitted.tax.minor).toBe(0);
    expect(omitted.total.minor).toBe(149_900);
  });

  it('charges a fee with no tax, and tax with no fee, independently', () => {
    const feeOnly = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1000, 'PKR'), quantity: 1 }],
      deliveryFee: fromMajor(250, 'PKR'),
      taxBasisPoints: 0,
    });
    expect(feeOnly.tax.minor).toBe(0);
    expect(feeOnly.total.minor).toBe(125_000);

    const taxOnly = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(1000, 'PKR'), quantity: 1 }],
      deliveryFee: PKR(0),
      taxBasisPoints: 1700,
    });
    expect(taxOnly.deliveryFee.minor).toBe(0);
    expect(taxOnly.tax.minor).toBe(17_000);
    expect(taxOnly.total.minor).toBe(117_000);
  });

  it('rounds a fractional tax to the nearest paisa with integer arithmetic', () => {
    // 17.5% of Rs. 99.99 is 1,749.825 paisa. Half-up on the exact rational, not on a
    // float that has already drifted.
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: PKR(9_999), quantity: 1 }],
      taxBasisPoints: 1750,
    });

    expect(totals.tax.minor).toBe(1_750);
    expect(totals.total.minor).toBe(11_749);
    expect(Number.isInteger(totals.tax.minor)).toBe(true);
  });
});

/**
 * The free-delivery threshold, which is the business rule with the most ways to be
 * subtly wrong: what counts towards it, whether reaching it exactly qualifies, and what
 * "not configured" means as distinct from "configured as zero".
 */
describe('free delivery threshold', () => {
  const goods = (minor: number) => [{ unitPrice: PKR(minor), quantity: 1 }];

  it('waives the fee when the goods reach the threshold exactly', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(300_000),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
    });

    // "Spend Rs. 3,000 for free delivery" means Rs. 3,000 qualifies, not Rs. 3,000.01.
    expect(totals.deliveryFee.minor).toBe(0);
    expect(totals.freeDeliveryApplied).toBe(true);
    expect(totals.total.minor).toBe(300_000);
  });

  it('waives the fee above the threshold and charges it below', () => {
    const above = computeOrderTotals({
      currency: 'PKR',
      lines: goods(300_001),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
    });
    expect(above.deliveryFee.minor).toBe(0);
    expect(above.freeDeliveryApplied).toBe(true);

    const below = computeOrderTotals({
      currency: 'PKR',
      lines: goods(299_999),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
    });
    expect(below.deliveryFee.minor).toBe(25_000);
    expect(below.freeDeliveryApplied).toBe(false);
    expect(below.total.minor).toBe(324_999);
  });

  it('measures the threshold against the goods after discounts', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(320_000),
      discount: PKR(50_000),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
    });

    // Rs. 3,200 of clothes minus a Rs. 500 discount is Rs. 2,700 of value, which is
    // below the line. Counting the pre-discount figure would give away delivery on a
    // basket the customer is not actually paying Rs. 3,000 for.
    expect(totals.deliveryFee.minor).toBe(25_000);
    expect(totals.freeDeliveryApplied).toBe(false);
  });

  it('excludes delivery and tax from the qualifying amount', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(290_000),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
      taxBasisPoints: 1700,
    });

    // Goods + fee is Rs. 3,150 and goods + fee + tax is more still, but the customer was
    // told to spend Rs. 3,000 on clothes, and Rs. 2,900 is not Rs. 3,000.
    expect(totals.deliveryFee.minor).toBe(25_000);
    expect(totals.freeDeliveryApplied).toBe(false);
  });

  it('charges the fee on any basket size when no threshold is configured', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(10_000_000),
      deliveryFee: PKR(25_000),
    });

    expect(totals.deliveryFee.minor).toBe(25_000);
    expect(totals.freeDeliveryApplied).toBe(false);
    expect(totals.total.minor).toBe(10_025_000);
  });

  it('treats a configured threshold of zero as always-free delivery', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(100),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(0),
    });

    // An owner who types 0 means "I never charge for delivery", which is a different
    // statement from leaving the field empty.
    expect(totals.deliveryFee.minor).toBe(0);
    expect(totals.freeDeliveryApplied).toBe(true);
  });

  it('does not claim free delivery when there was no fee to waive', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(500_000),
      freeDeliveryThreshold: PKR(300_000),
    });

    // A business that never charges for delivery must not have the agent congratulate
    // the customer on unlocking it.
    expect(totals.deliveryFee.minor).toBe(0);
    expect(totals.freeDeliveryApplied).toBe(false);
  });

  it('taxes the waived fee at zero rather than taxing a fee nobody pays', () => {
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: goods(300_000),
      deliveryFee: PKR(25_000),
      freeDeliveryThreshold: PKR(300_000),
      taxBasisPoints: 1700,
    });

    expect(totals.deliveryFee.minor).toBe(0);
    expect(totals.tax.minor).toBe(51_000); // 17% of the goods alone
    expect(totals.total.minor).toBe(351_000);
  });

  it('rejects a negative threshold and a mismatched threshold currency', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: goods(100_000),
        deliveryFee: PKR(25_000),
        freeDeliveryThreshold: money(-1, 'PKR'),
      }),
    ).toThrow(BusinessRuleError);

    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: goods(100_000),
        deliveryFee: PKR(25_000),
        freeDeliveryThreshold: money(300_000, 'USD'),
      }),
    ).toThrow(BusinessRuleError);
  });
});

describe('order totals reject bad input', () => {
  it('rejects an empty order', () => {
    expect(() => computeOrderTotals({ currency: 'PKR', lines: [] })).toThrow(BusinessRuleError);
  });

  it('rejects a fractional quantity', () => {
    expect(() =>
      computeOrderTotals({ currency: 'PKR', lines: [{ unitPrice: PKR(100), quantity: 1.5 }] }),
    ).toThrow(BusinessRuleError);
  });

  it('rejects a zero or negative quantity', () => {
    for (const quantity of [0, -1]) {
      expect(() =>
        computeOrderTotals({ currency: 'PKR', lines: [{ unitPrice: PKR(100), quantity }] }),
      ).toThrow(BusinessRuleError);
    }
  });

  it('rejects mixed currencies in one order', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: [
          { unitPrice: PKR(100), quantity: 1 },
          { unitPrice: money(100, 'USD'), quantity: 1 },
        ],
      }),
    ).toThrow(BusinessRuleError);
  });

  it('rejects a line discount larger than the line', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: [{ unitPrice: PKR(100), quantity: 1, discount: PKR(200) }],
      }),
    ).toThrow(BusinessRuleError);
  });

  it('rejects a negative discount, which would be a covert price increase', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: [{ unitPrice: PKR(100), quantity: 1 }],
        discount: money(-500, 'PKR'),
      }),
    ).toThrow(BusinessRuleError);
  });

  it('rejects a negative delivery fee', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: [{ unitPrice: PKR(100), quantity: 1 }],
        deliveryFee: money(-100, 'PKR'),
      }),
    ).toThrow(BusinessRuleError);
  });

  it('rejects an out-of-range tax rate', () => {
    for (const taxBasisPoints of [-1, 10_001, 17.5]) {
      expect(() =>
        computeOrderTotals({
          currency: 'PKR',
          lines: [{ unitPrice: PKR(100), quantity: 1 }],
          taxBasisPoints,
        }),
      ).toThrow(BusinessRuleError);
    }
  });

  it('rejects an absurd quantity that would overflow a sane order', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'PKR',
        lines: [{ unitPrice: PKR(100), quantity: 10_001 }],
      }),
    ).toThrow(BusinessRuleError);
  });
});
