/**
 * Money.
 *
 * Every amount in this system is an integer in minor units — paisa for PKR,
 * cents for USD — paired with an explicit currency. There is no code path where
 * a price is a float.
 *
 * The reason is not fussiness. `0.1 + 0.2 !== 0.3` in IEEE 754, and an order
 * total that is off by a hundredth of a rupee is an order total a customer will
 * argue about and an accountant cannot reconcile. Integers make the arithmetic
 * exact and the rounding explicit at the one point where rounding is
 * unavoidable: percentage calculations.
 *
 * Dependency-free, so it is unit-tested directly with no bundler or database.
 */

import {
  BASIS_POINTS_DIVISOR,
  DEFAULT_CURRENCY,
  MINOR_UNITS_PER_MAJOR,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../config/constants';

export type Money = {
  /** Integer. Negative values are legal — refunds and adjustments need them. */
  readonly minor: number;
  readonly currency: SupportedCurrency;
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Type guard for the supported-currency union. A currency string read from the
 * database is `string` at the type level; this narrows it to the union so the
 * value can flow into `money()` without a cast.
 */
export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Coerces an arbitrary currency string to a supported one, falling back to the
 * default. Fails closed: a stored value that is somehow unknown formats as the
 * default currency rather than throwing at render time.
 */
export function coerceCurrency(value: string): SupportedCurrency {
  return isSupportedCurrency(value) ? value : DEFAULT_CURRENCY;
}

export function money(minor: number, currency: SupportedCurrency = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(
      `Money must be an integer number of minor units, received ${minor}. ` +
        `Did a float or a major-unit value leak in?`,
    );
  }
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Money value ${minor} exceeds safe integer range.`);
  }
  return { minor, currency };
}

export const zero = (currency: SupportedCurrency = DEFAULT_CURRENCY): Money =>
  money(0, currency);

/**
 * Converts a major-unit amount, as typed into a form, to minor units.
 * Rounds half away from zero, which is what a person expects when they type
 * 34.995 and mean 35.00 rather than 34.99.
 *
 * Note the limit of the input type: a value like 1.005 has no exact binary
 * representation, and the nearest double is below the tie, so it rounds down.
 * Prefer `parseMoney` for anything a user typed — it reads the decimal string and
 * is not subject to this.
 */
export function fromMajor(
  major: number,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): Money {
  if (!Number.isFinite(major)) {
    throw new MoneyError(`Cannot convert non-finite value ${major} to money.`);
  }
  const scaled = major * MINOR_UNITS_PER_MAJOR;
  // Math.round breaks ties toward +Infinity, so -0.5 would become -0. Sign is
  // handled explicitly to keep the behaviour symmetric.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return money(rounded, currency);
}

export function toMajor(value: Money): number {
  return value.minor / MINOR_UNITS_PER_MAJOR;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Cannot combine ${a.currency} with ${b.currency}. ` +
        `Mixed-currency arithmetic must go through an explicit conversion.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function sum(
  values: readonly Money[],
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): Money {
  return values.reduce<Money>((total, value) => add(total, value), zero(currency));
}

/** Multiplication by a whole quantity — the line-item case. Stays exact. */
export function multiply(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(
      `Quantity must be a whole number, received ${quantity}. ` +
        `Use percentageOf for fractional scaling so the rounding is explicit.`,
    );
  }
  return money(value.minor * quantity, value.currency);
}

/**
 * Applies a rate expressed in basis points. 17% VAT is 1700 bps.
 *
 * Basis points rather than a float percentage because 0.17 cannot be
 * represented exactly, and tax is exactly the calculation nobody will tolerate
 * being off by a paisa. Rounds half away from zero.
 */
export function percentageOf(value: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError(`Basis points must be an integer, received ${basisPoints}.`);
  }
  const scaled = (value.minor * basisPoints) / BASIS_POINTS_DIVISOR;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return money(rounded, value.currency);
}

export function isZero(value: Money): boolean {
  return value.minor === 0;
}

export function isNegative(value: Money): boolean {
  return value.minor < 0;
}

export function isPositive(value: Money): boolean {
  return value.minor > 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** Clamps to zero. A discount larger than the subtotal must not owe the
 *  customer money. */
export function clampToZero(value: Money): Money {
  return value.minor < 0 ? zero(value.currency) : value;
}

const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  PKR: 'Rs.',
  USD: '$',
  AED: 'AED',
  GBP: '£',
  EUR: '€',
};

export type FormatMoneyOptions = {
  /** Hide the ".00" tail when the amount is whole. Prices read better without
   *  it in Pakistani retail, where amounts are almost always whole rupees. */
  compactDecimals?: boolean;
  showSymbol?: boolean;
  locale?: string;
};

/**
 * Formats for display. Uses `Intl.NumberFormat` for digit grouping so that a
 * locale using lakh/crore grouping renders the way its readers expect.
 */
export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const { compactDecimals = true, showSymbol = true, locale = 'en-PK' } = options;

  const major = Math.abs(value.minor) / MINOR_UNITS_PER_MAJOR;
  const hasFraction = value.minor % MINOR_UNITS_PER_MAJOR !== 0;
  const fractionDigits = compactDecimals && !hasFraction ? 0 : 2;

  const digits = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);

  const sign = value.minor < 0 ? '-' : '';
  const symbol = showSymbol ? `${CURRENCY_SYMBOLS[value.currency]} ` : '';

  return `${sign}${symbol}${digits}`;
}

/**
 * Parses free-text money input — a form field, or a number the AI extracted
 * from a customer message. Returns null rather than throwing, because invalid
 * input here is expected and belongs in a validation message.
 *
 * Accepts "3499", "3,499", "Rs. 3499", "3499.50". Rejects anything with more
 * than two decimal places, since that is more likely a typo or a thousands
 * separator misread than a real sub-paisa price.
 */
export function parseMoney(
  input: string,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): Money | null {
  const cleaned = input
    .trim()
    .replace(/^(rs\.?|pkr|usd|aed|gbp|eur|[$£€])\s*/i, '')
    .replace(/,/g, '')
    .replace(/\s/g, '');

  if (cleaned === '' || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return fromMajor(parsed, currency);
}
