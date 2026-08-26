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
