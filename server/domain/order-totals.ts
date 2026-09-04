/**
 * Order total computation.
 *
 * This module is the only place order money is calculated. Not the client, and
 * emphatically not the AI — a language model asked to add up a basket will
 * usually get it right, which is precisely what makes trusting it dangerous. The
 * AI proposes line items; the server prices them from the catalogue and computes
 * the total.
 *
 * Pure, and depends only on `lib/money`, so every rounding rule below is unit
 * tested.
 */

import {
  add,
  clampToZero,
  compare,
  isZero,
  type Money,
  money,
  multiply,
  percentageOf,
  subtract,
  sum,
} from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import { BusinessRuleError } from '@/server/errors';

export type OrderLineInput = {
  /** Resolved from the catalogue by the caller. Never accepted from the client or
   *  from a tool call. */
  readonly unitPrice: Money;
  readonly quantity: number;
  /** Per-line discount in minor units, already validated as authorised. */
  readonly discount?: Money;
};

export type OrderLineTotals = {
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly gross: Money;
  readonly discount: Money;
  readonly total: Money;
};

export type OrderChargeInput = {
  readonly currency: SupportedCurrency;
  readonly lines: readonly OrderLineInput[];
  readonly deliveryFee?: Money;
  /** Order-level discount, applied after line discounts. */
  readonly discount?: Money;
  /**
   * The goods value at or above which delivery stops being charged, from the
   * business's own settings.
   *
   * Undefined means no threshold is configured, which is a different statement
   * from a threshold of zero: zero means "delivery is always free", and a shop
   * owner who types 0 means exactly that.
   */
  readonly freeDeliveryThreshold?: Money;
  /** Tax in basis points — 1750 is 17.5%. Basis points because a float rate
   *  reintroduces the rounding error the integer money type exists to avoid. */
  readonly taxBasisPoints?: number;
  /** Whether `unitPrice` already contains tax, which is the norm for Pakistani
   *  retail: a shirt marked Rs. 3,499 is Rs. 3,499 at the till. */
  readonly taxInclusive?: boolean;
};

export type OrderTotals = {
  readonly currency: SupportedCurrency;
  readonly lines: readonly OrderLineTotals[];
  readonly subtotal: Money;
  readonly discount: Money;
  readonly deliveryFee: Money;
  readonly tax: Money;
  readonly total: Money;
  /**
   * Whether the threshold waived a fee that would otherwise have been charged.
   *
   * False when there was no fee to waive, so a caller can read it as "tell the
   * customer their basket earned free delivery" without it firing for a business
   * that never charges for delivery in the first place.
   */
  readonly freeDeliveryApplied: boolean;
};

const MAX_LINE_QUANTITY = 10_000;
const MAX_LINES = 200;

export function computeOrderTotals(input: OrderChargeInput): OrderTotals {
  const { currency } = input;

  if (input.lines.length === 0) {
    throw new BusinessRuleError('An order needs at least one item.');
  }
  if (input.lines.length > MAX_LINES) {
    throw new BusinessRuleError(`An order cannot have more than ${MAX_LINES} different items.`);
  }

  const zero = money(0, currency);

  const lines: OrderLineTotals[] = input.lines.map((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new BusinessRuleError(`Item ${index + 1} needs a whole quantity of at least 1.`);
    }
    if (line.quantity > MAX_LINE_QUANTITY) {
      throw new BusinessRuleError(`Item ${index + 1} quantity is unrealistically large.`);
    }
    if (line.unitPrice.currency !== currency) {
      throw new BusinessRuleError('All items in an order must use the same currency.');
    }
    if (line.unitPrice.minor < 0) {
      throw new BusinessRuleError(`Item ${index + 1} has a negative price.`);
    }

    const gross = multiply(line.unitPrice, line.quantity);
    const discount = line.discount ?? zero;

    if (discount.currency !== currency) {
      throw new BusinessRuleError('Discount currency must match the order currency.');
    }
    if (discount.minor < 0) {
      throw new BusinessRuleError('A discount cannot be negative.');
    }
    // A line discount larger than the line would make the item a source of
    // revenue for the customer.
    if (discount.minor > gross.minor) {
      throw new BusinessRuleError(`Discount on item ${index + 1} is larger than the item total.`);
    }

    return {
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      gross,
      discount,
      total: subtract(gross, discount),
    };
  });

  const subtotal = sum(lines.map((line) => line.total), currency);

  const orderDiscount = input.discount ?? zero;
  if (orderDiscount.currency !== currency) {
    throw new BusinessRuleError('Discount currency must match the order currency.');
  }
  if (orderDiscount.minor < 0) {
    throw new BusinessRuleError('A discount cannot be negative.');
  }

  // Clamped rather than rejected: an order-level discount that exceeds the
  // basket is a plausible thing for a shop owner to type, and the sane outcome
  // is a free order, not an error dialogue. Goods total floors at zero; delivery
  // is charged regardless, since the courier is paid either way.
  const discountedSubtotal = clampToZero(subtract(subtotal, orderDiscount));
  const appliedOrderDiscount = subtract(subtotal, discountedSubtotal);

  const configuredDeliveryFee = input.deliveryFee ?? zero;
  if (configuredDeliveryFee.currency !== currency) {
    throw new BusinessRuleError('Delivery fee currency must match the order currency.');
  }
  if (configuredDeliveryFee.minor < 0) {
    throw new BusinessRuleError('A delivery fee cannot be negative.');
  }

  const freeDeliveryThreshold = input.freeDeliveryThreshold;
  if (freeDeliveryThreshold) {
    if (freeDeliveryThreshold.currency !== currency) {
      throw new BusinessRuleError(
        'Free delivery threshold currency must match the order currency.',
      );
    }
    if (freeDeliveryThreshold.minor < 0) {
      throw new BusinessRuleError('A free delivery threshold cannot be negative.');
    }
  }

  // The threshold is tested against the goods value after every discount, and
  // deliberately excludes delivery and tax. Including the fee in the amount that
  // decides whether to charge the fee is circular, and including tax would let a
  // basket cross the line on tax alone — a customer who is told "spend Rs. 5,000
  // for free delivery" is thinking about the price of the clothes.
  const freeDeliveryApplied =
    freeDeliveryThreshold !== undefined &&
    !isZero(configuredDeliveryFee) &&
    compare(discountedSubtotal, freeDeliveryThreshold) >= 0;

  const deliveryFee = freeDeliveryApplied ? zero : configuredDeliveryFee;

  const taxBasisPoints = input.taxBasisPoints ?? 0;
  if (!Number.isInteger(taxBasisPoints) || taxBasisPoints < 0 || taxBasisPoints > 10_000) {
    throw new BusinessRuleError('Tax rate must be between 0 and 10000 basis points.');
  }

  const taxableBase = add(discountedSubtotal, deliveryFee);

  if (taxBasisPoints === 0) {
    const total = taxableBase;
    return {
      currency,
      lines,
      subtotal,
      discount: add(sumLineDiscounts(lines, currency), appliedOrderDiscount),
      deliveryFee,
      tax: zero,
      total,
      freeDeliveryApplied,
    };
  }

  if (input.taxInclusive) {
    // The marked price already contains tax, so the total is unchanged and the tax
    // is extracted for reporting: tax = base × rate / (10000 + rate).
    const taxMinor = Math.round(
      (taxableBase.minor * taxBasisPoints) / (10_000 + taxBasisPoints),
    );
    return {
      currency,
      lines,
      subtotal,
      discount: add(sumLineDiscounts(lines, currency), appliedOrderDiscount),
      deliveryFee,
      tax: money(taxMinor, currency),
      total: taxableBase,
      freeDeliveryApplied,
    };
  }

  const tax = percentageOf(taxableBase, taxBasisPoints);
  return {
    currency,
    lines,
    subtotal,
    discount: add(sumLineDiscounts(lines, currency), appliedOrderDiscount),
    deliveryFee,
    tax,
    total: add(taxableBase, tax),
    freeDeliveryApplied,
  };
}

function sumLineDiscounts(
  lines: readonly OrderLineTotals[],
  currency: SupportedCurrency,
): Money {
  return sum(lines.map((line) => line.discount), currency);
}

/**
 * Recomputes a stored order's total and compares it with the persisted figure.
 *
 * Used before capturing a payment. If they disagree, something has mutated the
 * order outside this function and the payment must not proceed.
 */
export function totalsMatch(computed: OrderTotals, persistedTotalMinor: number): boolean {
  return computed.total.minor === persistedTotalMinor;
}
