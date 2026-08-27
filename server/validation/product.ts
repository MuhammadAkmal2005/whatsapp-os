/**
 * Validation schemas for products, variants and stock.
 *
 * The same schemas back the product forms and the server actions, so the browser and
 * the server cannot disagree about what a valid product is.
 *
 * Prices arrive as **strings**, not numbers, and are converted to integer minor units
 * by the service rather than here. Three reasons, in order of how much they cost when
 * ignored:
 *
 *   1. Which currency `3499` is depends on the workspace, which the schema cannot see.
 *      This is the same reason `contact.ts` does not normalise phone numbers: a schema
 *      that hard-coded PKR would file a Dubai seller's prices as rupees.
 *   2. `z.number()` on a form field means the browser hands over a float, and a float
 *      is exactly what `lib/money` exists to keep out of the system. A string never
 *      silently becomes 3498.9999999999995.
 *   3. A shop owner types `Rs. 3,499` and `3499.50` and expects both to work.
 *      `parseMoney` already handles that, and calling it from the refinement means the
 *      schema and the parser cannot drift into disagreeing about what is acceptable —
 *      which would produce a value the form accepted and the service then rejected.
 */

import { z } from 'zod';

import { parseMoney } from '@/lib/money';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';

const NAME_MAX = 140;
const DESCRIPTION_MAX = 5000;
const SKU_MAX = 64;
const PRICE_MAX = 20;
const VARIANT_LABEL_MAX = 60;
const SEARCH_MAX = 80;

/** A quantity nobody reaches legitimately, and past which the arithmetic in an order
 *  starts being worth thinking about. A shop owner with more than a million of one
 *  item has a different problem than this form. */
const QUANTITY_MAX = 1_000_000;

/** The same limits the schemas enforce, exported for the forms' `maxLength`, for the
 *  reason documented on `CONTACT_FIELD_MAX`: an attribute that disagrees with the
 *  server stops accepting keystrokes at a length the server would have allowed, and
 *  the person cannot tell why. */
export const PRODUCT_FIELD_MAX = {
  name: NAME_MAX,
  description: DESCRIPTION_MAX,
  sku: SKU_MAX,
  price: PRICE_MAX,
  variantLabel: VARIANT_LABEL_MAX,
  search: SEARCH_MAX,
  quantity: QUANTITY_MAX,
} as const;

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const productStatus = z.enum(PRODUCT_STATUSES, {
  errorMap: () => ({ message: 'Choose whether this product is a draft, active or archived.' }),
});

export const productId = z.string().uuid('That product reference is not valid.');
export const variantId = z.string().uuid('That variant reference is not valid.');

/** Blank and absent mean the same thing on a form, and both mean "no value stored". */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

/**
 * Uppercased, because a SKU is an identifier a human types from a label and
 * `KURTA-BLK` and `kurta-blk` are the same item. Without this the unique index
 * treats them as two products and the second save succeeds when it should have been
 * caught as a duplicate.
 */
const skuInput = z
  .string()
  .trim()
  .toUpperCase()
  .max(SKU_MAX, 'That SKU is too long.')
  .regex(/^[A-Z0-9._\-/]*$/, 'A SKU can use letters, numbers and - _ . / only.')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

/**
 * Shape-checks a typed amount by asking `parseMoney` whether it can read it.
 *
 * The currency passed here is irrelevant to the answer — `parseMoney` accepts or
 * rejects on the shape of the string, and `MINOR_UNITS_PER_MAJOR` is one scale for
 * every supported currency — so this settles "is this a number a person meant" without
 * pretending to know which currency it is. The service does the real conversion with
 * the workspace's currency.
 */
function parsesAsMoney(value: string): boolean {
  return parseMoney(value) !== null;
}

/** Negative is rejected rather than clamped: a price typed as `-500` is a typo or a
 *  paste accident, and silently storing 500 would be a guess about money. */
function isNotNegative(value: string): boolean {
  const parsed = parseMoney(value);
  return parsed !== null && parsed.minor >= 0;
}

const priceInput = z
  .string()
  .trim()
  .min(1, 'Enter a price.')
  .max(PRICE_MAX, 'That price is too long — check for extra digits.')
  .refine(parsesAsMoney, { message: 'Enter a price like 3499 or 3,499.50.' })
  .refine(isNotNegative, { message: 'A price cannot be negative.' });

/** Absent means "no sale", which is different from a sale price of zero — a free item
 *  is a real, if rare, promotion. Both have to be expressible. */
const optionalPriceInput = z
  .string()
  .trim()
  .max(PRICE_MAX, 'That price is too long — check for extra digits.')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || parsesAsMoney(value), {
    message: 'Enter a sale price like 2999, or leave it empty.',
  })
  .refine((value) => value === null || isNotNegative(value), {
    message: 'A sale price cannot be negative.',
  });

/**
 * Blank is missing, not zero.
 *
 * `formData.get` returns `''` for an empty input, and `z.coerce.number()` reads `''`
 * as `0`. Left alone that makes three quiet mistakes: a stocktake submitted with the
 * field untouched sets stock to zero, a blank low-stock threshold silently switches the
 * alert off, and a blank weight is stored as zero grams rather than as unknown. Each
 * looks like a successful save.
 *
 * So blanks are erased to `undefined` first, and then a required field says "enter a
 * number" instead of accepting a value nobody typed.
 */
const blankToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const quantityRules = z.coerce
  .number({
    required_error: 'Enter a number.',
    invalid_type_error: 'Enter a number.',
  })
  .int('Enter a whole number.')
  .min(0, 'Stock cannot be negative.')
  .max(QUANTITY_MAX, 'That is more stock than this form can record.');

const quantityInput = z.preprocess(blankToUndefined, quantityRules);
const optionalQuantityInput = z.preprocess(blankToUndefined, quantityRules.optional());

/**
 * A checkbox is not a boolean, and treating it as one breaks in the direction that
 * matters.
 *
 * An unchecked checkbox posts *nothing*, so `.default(true)` would make "do not track
 * stock for this product" unexpressible — the absent field and the deliberate no are
 * the same request. And `z.coerce.boolean()` reads the string `'false'` as `true`,
 * because every non-empty string is truthy, which turns an explicit no into a yes.
 *
 * Hence an explicit mapping over the values a form and a query string actually send,
 * with absence meaning false. The product form always posts a value, so the default
 * lives in the form's initial state where a person can see it, not in a coercion rule.
 */
const flagInput = z
  .union([z.boolean(), z.enum(['true', 'false', 'on', 'off', '1', '0'])])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === 'on' || value === '1';
  });

/**
 * A sale price above the normal price is not a sale, and it is the one cross-field
 * money rule worth catching on the field rather than on submit — the person is looking
 * at both numbers and can see the mistake.
 *
 * Comparing the two strings is sound despite neither being converted yet: ordering is
 * unaffected by which currency they turn out to be, so long as they are both the same
 * one, and they always are. The service re-derives both amounts and does not trust
 * this having happened.
 */
function saleBelowPrice(input: {
  priceMinor?: string | null;
  salePriceMinor?: string | null;
}): boolean {
  if (!input.priceMinor || !input.salePriceMinor) return true;
  const price = parseMoney(input.priceMinor);
  const sale = parseMoney(input.salePriceMinor);
  if (!price || !sale) return true; // Already reported by the field refinements.
  return sale.minor <= price.minor;
}

/** The message is attached to the sale price rather than the object, so the form shows
 *  it under the field the person would change. `path` is a mutable array because that
 *  is what Zod's `RefinementCtx` takes. */
const SALE_ABOVE_PRICE = {
  message: 'The sale price has to be lower than the normal price.',
  path: ['salePriceMinor'],
};

const productFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Give the product a name your customers would recognise.')
    .max(NAME_MAX, 'That name is too long.'),
  description: optionalText(DESCRIPTION_MAX, 'That description is too long.'),
  sku: skuInput,
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))
    .refine((value) => value === null || z.string().uuid().safeParse(value).success, {
      message: 'That category reference is not valid.',
    }),
  /** Named `…Minor` even though it is a string, so the field name matches the column
   *  it becomes and a reader grepping for `priceMinor` finds both ends. */
  priceMinor: priceInput,
  salePriceMinor: optionalPriceInput,
  trackInventory: flagInput,
  weightGrams: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: 'Enter a whole number of grams.' })
      .int('Enter a whole number of grams.')
      .min(0, 'Weight cannot be negative.')
      .max(500_000, 'That weight looks wrong — enter it in grams.')
      .optional(),
  ),
};

/**
 * A new product is ACTIVE unless it is explicitly a draft.
 *
 * The safer-looking default is DRAFT, and it is the wrong one here: a shop owner who
 * adds a kurta and then finds the AI telling customers it does not exist has hit a
 * silent failure they have no way to diagnose. Name and price are both required, so an
 * active product is complete enough to sell, and `DRAFT` remains available for someone
 * building a catalogue ahead of a launch.
 */
export const createProductSchema = z
  .object({
    ...productFields,
    status: productStatus.default('ACTIVE'),
    /** Asked on the create form as "how many do you have?", because a product with no
     *  stock is invisible to the AI and the omission is not obvious. */
    initialStock: optionalQuantityInput,
    lowStockThreshold: optionalQuantityInput,
  })
  .refine(saleBelowPrice, SALE_ABOVE_PRICE);

/**
 * The slug is absent on purpose. It is derived from the name by the service, where the
 * uniqueness check against `@@unique([workspaceId, slug])` can actually happen, and it
 * is not something a shop owner should be asked about.
 */
export const updateProductSchema = z
  .object({
    productId,
    ...productFields,
    status: productStatus,
  })
  .refine(saleBelowPrice, SALE_ABOVE_PRICE);

export const deleteProductSchema = z.object({ productId });

export const setProductStatusSchema = z.object({
  productId,
  status: productStatus,
});

/**
 * Variant prices are overrides, so both are optional: null means "use the product's
 * price", which is the common case for a size that costs the same.
 */
export const createVariantSchema = z
  .object({
    productId,
    name: optionalText(VARIANT_LABEL_MAX, 'That variant name is too long.'),
    size: optionalText(VARIANT_LABEL_MAX, 'That size label is too long.'),
    color: optionalText(VARIANT_LABEL_MAX, 'That colour name is too long.'),
    sku: skuInput,
    priceMinor: optionalPriceInput,
    salePriceMinor: optionalPriceInput,
    status: productStatus.default('ACTIVE'),
    initialStock: optionalQuantityInput,
  })
  .refine(saleBelowPrice, SALE_ABOVE_PRICE)
  .refine((input) => Boolean(input.name ?? input.size ?? input.color), {
    message: 'Give the variant a size, a colour or a name so your team can tell them apart.',
    path: ['size'],
  });

export const updateVariantSchema = z
  .object({
    variantId,
    name: optionalText(VARIANT_LABEL_MAX, 'That variant name is too long.'),
    size: optionalText(VARIANT_LABEL_MAX, 'That size label is too long.'),
    color: optionalText(VARIANT_LABEL_MAX, 'That colour name is too long.'),
    sku: skuInput,
    priceMinor: optionalPriceInput,
    salePriceMinor: optionalPriceInput,
    status: productStatus,
  })
  .refine(saleBelowPrice, SALE_ABOVE_PRICE);

export const deleteVariantSchema = z.object({ variantId });

/**
 * Two ways to change stock, and the distinction is not pedantic.
 *
 * `setStock` is a stocktake: "there are 27 on the shelf". `adjustStock` is a movement:
 * "12 arrived", "2 were damaged". A movement is safe when two people submit at once
 * because it is relative; an absolute set is last-write-wins, which is correct for a
 * count someone has just performed and wrong for a delivery.
 */
export const setStockSchema = z.object({
  productId,
  variantId: variantId.nullable().optional(),
  available: quantityInput,
});

export const adjustStockSchema = z.object({
  productId,
  variantId: variantId.nullable().optional(),
  delta: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({
        required_error: 'Enter how many were added or removed.',
        invalid_type_error: 'Enter a number.',
      })
      .int('Enter a whole number.')
      .min(-QUANTITY_MAX, 'That is a larger reduction than this form can record.')
      .max(QUANTITY_MAX, 'That is more stock than this form can record.')
      .refine((value) => value !== 0, { message: 'Enter how many were added or removed.' }),
  ),
  reason: optionalText(140, 'Keep the reason short.'),
});

export const setLowStockThresholdSchema = z.object({
  productId,
  variantId: variantId.nullable().optional(),
  lowStockThreshold: quantityInput,
});

/**
 * List filters.
 *
 * `lowStock` is a filter rather than a separate page because it is the question a shop
 * owner asks of this same list: "what am I about to run out of?". It is a *flag* rather
 * than a boolean because these values arrive from the query string, where `true` is the
 * five-character string and `z.boolean()` would reject every link the UI produces.
 *
 * Cursor pagination, for the reason documented on `listContactsSchema`. `limit` stays
 * out of the URL there and here: it decides how much work Postgres does per request.
 */
export const listProductsSchema = z.object({
  search: optionalText(SEARCH_MAX, 'Search for something shorter.'),
  status: productStatus.optional(),
  categoryId: z.string().uuid('That category reference is not valid.').optional(),
  lowStock: flagInput,
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type DeleteProductInput = z.infer<typeof deleteProductSchema>;
export type SetProductStatusInput = z.infer<typeof setProductStatusSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type DeleteVariantInput = z.infer<typeof deleteVariantSchema>;
export type SetStockInput = z.infer<typeof setStockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type SetLowStockThresholdInput = z.infer<typeof setLowStockThresholdSchema>;
export type ListProductsInput = z.infer<typeof listProductsSchema>;

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

/** What each status means for the shop owner, in terms of consequence rather than
 *  state — "the AI will offer this" is the fact they actually care about. */
export const PRODUCT_STATUS_DESCRIPTIONS: Record<ProductStatus, string> = {
  DRAFT: 'Only your team can see it. Your AI will not offer it to customers.',
  ACTIVE: 'Your AI can offer it and customers can order it.',
  ARCHIVED: 'Hidden from customers, and kept so past orders still make sense.',
};
