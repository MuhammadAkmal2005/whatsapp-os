import { DEFAULT_CURRENCY } from '@/config/constants';
import { add, formatMoney, money, multiply } from '@/lib/money';

/**
 * The one sample order the public site quotes from.
 *
 * Every figure below is computed with the same money helpers the order service uses, rather
 * than typed as a string, so the mockups cannot drift into arithmetic that does not add up.
 * A shop owner reading the hero will check the total — that is the whole reason the number
 * is there — and getting it wrong would cost more trust than the illustration buys.
 *
 * Fictional customer, fictional order. No real person, number or address appears here.
 */

const UNIT_PRICE = money(349_900, DEFAULT_CURRENCY); // Rs. 3,499
const QUANTITY = 2;
const DELIVERY = money(25_000, DEFAULT_CURRENCY); // Rs. 250

const SUBTOTAL = multiply(UNIT_PRICE, QUANTITY);
const TOTAL = add(SUBTOTAL, DELIVERY);

export const SAMPLE_ORDER = {
  reference: '#1042',
  productName: 'Black Kurta',
  variant: 'XL',
  quantity: QUANTITY,
  unitPrice: formatMoney(UNIT_PRICE),
  subtotal: formatMoney(SUBTOTAL),
  delivery: formatMoney(DELIVERY),
  total: formatMoney(TOTAL),
  paymentMethod: 'Cash on delivery',
  city: 'Karachi',
} as const;
