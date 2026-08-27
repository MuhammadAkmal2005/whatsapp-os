'use server';

/**
 * Product server actions.
 *
 * Thin adapters: parse, delegate, translate. Every one resolves its own tenant context
 * rather than accepting a workspace id, so the scope comes from the session cookie and a
 * crafted form post cannot reprice another business's catalogue.
 *
 * None of these check permissions. `requirePermission` runs inside the service, which is
 * the one place the pages, the API routes and the AI's tools all share.
 *
 * Note what is *not* converted here. Prices arrive as the strings a person typed and stay
 * strings all the way into the service, which converts them with the workspace's currency.
 * An action that parsed money would be a second place money is interpreted, and the two
 * would eventually disagree about what `3,499.50` means.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { getRequestMeta } from '@/server/http/request-meta';
import {
  createProduct,
  deleteProduct,
  setProductStatus,
  updateProduct,
} from '@/server/services/product/product.service';
import {
  adjustStock,
  setLowStockThreshold,
  setStock,
} from '@/server/services/product/stock.service';
import {
  createVariant,
  deleteVariant,
  updateVariant,
} from '@/server/services/product/variant.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  adjustStockSchema,
  createProductSchema,
  createVariantSchema,
  deleteProductSchema,
  deleteVariantSchema,
  setLowStockThresholdSchema,
  setProductStatusSchema,
  setStockSchema,
  updateProductSchema,
  updateVariantSchema,
} from '@/server/validation/product';

const PRODUCTS_PATH = '/products';

const productPath = (id: string) => `${PRODUCTS_PATH}/${id}`;

/** The editable fields, read in one place so the create and update actions cannot drift
 *  apart on which fields they accept. */
function productFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name') ?? undefined,
    description: formData.get('description') ?? undefined,
    sku: formData.get('sku') ?? undefined,
    categoryId: formData.get('categoryId') ?? undefined,
    priceMinor: formData.get('priceMinor') ?? undefined,
    salePriceMinor: formData.get('salePriceMinor') ?? undefined,
    trackInventory: formData.get('trackInventory') ?? undefined,
    weightGrams: formData.get('weightGrams') ?? undefined,
  };
}

function variantFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name') ?? undefined,
    size: formData.get('size') ?? undefined,
    color: formData.get('color') ?? undefined,
    sku: formData.get('sku') ?? undefined,
    priceMinor: formData.get('priceMinor') ?? undefined,
    salePriceMinor: formData.get('salePriceMinor') ?? undefined,
  };
}

/**
 * A stock form posts an empty string for the product-level row, because a hidden input
 * cannot hold `null`. Empty means "the product itself"; a uuid means one of its sizes.
 */
function variantTargetFrom(formData: FormData) {
  const raw = formData.get('variantId');
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

// ── Products ───────────────────────────────────────────────────────────────

/**
 * Creates a product and goes straight to its page, where stock and sizes are added.
 *
 * The redirect is outside the try block on purpose. Next.js implements `redirect` by
 * throwing, so calling it inside would be caught below and reported to the person as a
 * failed save — of a product that was in fact saved.
 */
export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createProductSchema.safeParse({
    ...productFieldsFrom(formData),
    status: formData.get('status') ?? undefined,
    initialStock: formData.get('initialStock') ?? undefined,
    lowStockThreshold: formData.get('lowStockThreshold') ?? undefined,
  });
  if (!parsed.success) return validationFormState(parsed.error);

  let createdId: string;
  try {
    const ctx = await requireTenantContext();
    const product = await createProduct(ctx, parsed.data, await getRequestMeta());
    createdId = product.id;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  redirect(productPath(createdId));
}

export async function updateProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateProductSchema.safeParse({
    productId: formData.get('productId'),
    ...productFieldsFrom(formData),
    status: formData.get('status'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await updateProduct(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(productPath(parsed.data.productId));
  return { status: 'success', message: 'Product saved.' };
}

/** The quick toggle on a list row, so taking a sold-out style off the catalogue does not
 *  mean a trip through the pricing form. */
export async function setProductStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setProductStatusSchema.safeParse({
    productId: formData.get('productId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await setProductStatus(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(productPath(parsed.data.productId));
  return {
    status: 'success',
    message:
      parsed.data.status === 'ACTIVE'
        ? 'Product is on your catalogue.'
        : 'Product is off your catalogue.',
  };
}

/** Redirects back to the list, because the page the person was on no longer has anything
 *  to show. Same reason the redirect sits outside the try block. */
export async function deleteProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteProductSchema.safeParse({ productId: formData.get('productId') });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await deleteProduct(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  redirect(PRODUCTS_PATH);
}

// ── Variants ───────────────────────────────────────────────────────────────

export async function createVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createVariantSchema.safeParse({
    productId: formData.get('productId'),
    ...variantFieldsFrom(formData),
    status: formData.get('status') ?? undefined,
    initialStock: formData.get('initialStock') ?? undefined,
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await createVariant(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(productPath(parsed.data.productId));
  revalidatePath(PRODUCTS_PATH);
  return { status: 'success', message: 'Size added.' };
}

/**
 * Takes the product id as a separate field purely so the page can be revalidated. The
 * service does not receive it and does not trust it — the variant is found by its own id
 * inside the workspace, and its parent is read from the row.
 */
export async function updateVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateVariantSchema.safeParse({
    variantId: formData.get('variantId'),
    ...variantFieldsFrom(formData),
    status: formData.get('status'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  let productId: string;
  try {
    const ctx = await requireTenantContext();
    const variant = await updateVariant(ctx, parsed.data, await getRequestMeta());
    productId = variant.productId;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(productPath(productId));
  revalidatePath(PRODUCTS_PATH);
  return { status: 'success', message: 'Size saved.' };
}

export async function deleteVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteVariantSchema.safeParse({ variantId: formData.get('variantId') });
  if (!parsed.success) return validationFormState(parsed.error);

  // The parent id comes from the form because the service returns nothing to learn it
  // from, and it is used only to revalidate a cached page. It is never passed to the
  // service and never authorizes anything, so a tampered value costs a wasted cache
  // invalidation and nothing else.
  const returnTo = formData.get('productId');

  try {
    const ctx = await requireTenantContext();
    await deleteVariant(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  if (typeof returnTo === 'string' && returnTo.length > 0) revalidatePath(productPath(returnTo));
  revalidatePath(PRODUCTS_PATH);
  return { status: 'success', message: 'Size removed.' };
}

// ── Stock ──────────────────────────────────────────────────────────────────

/** A stocktake: "there are 27 on the shelf". */
export async function setStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = setStockSchema.safeParse({
    productId: formData.get('productId'),
    variantId: variantTargetFrom(formData),
    available: formData.get('available'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  let available: number;
  try {
    const ctx = await requireTenantContext();
    const stock = await setStock(ctx, parsed.data, await getRequestMeta());
    available = stock.available;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(productPath(parsed.data.productId));
  return {
    status: 'success',
    message: `Stock set to ${available}.`,
  };
}

/** A movement: "12 arrived", "2 were damaged". Relative, so two people recording
 *  deliveries at the same time do not overwrite each other. */
export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = adjustStockSchema.safeParse({
    productId: formData.get('productId'),
    variantId: variantTargetFrom(formData),
    delta: formData.get('delta'),
    reason: formData.get('reason') ?? undefined,
  });
  if (!parsed.success) return validationFormState(parsed.error);

  let available: number;
  try {
    const ctx = await requireTenantContext();
    const stock = await adjustStock(ctx, parsed.data, await getRequestMeta());
    available = stock.available;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(productPath(parsed.data.productId));
  return {
    status: 'success',
    message: `${parsed.data.delta > 0 ? 'Added' : 'Removed'} ${Math.abs(parsed.data.delta)}. ${available} now available.`,
  };
}

export async function setLowStockThresholdAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setLowStockThresholdSchema.safeParse({
    productId: formData.get('productId'),
    variantId: variantTargetFrom(formData),
    lowStockThreshold: formData.get('lowStockThreshold'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await setLowStockThreshold(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(productPath(parsed.data.productId));
  return {
    status: 'success',
    message: `You will be warned at ${parsed.data.lowStockThreshold} or fewer.`,
  };
}
