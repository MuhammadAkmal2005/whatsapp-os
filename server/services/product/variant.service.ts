/**
 * Variant service.
 *
 * Sizes and colours. Separate from `product.service.ts` because they are edited from a
 * different place — a table on the product page, not the product form — and because the
 * two have genuinely different rules:
 *
 *   1. **A variant price is an override, and may be absent.** Null means "use the
 *      product's price", which is the ordinary case for an XL that costs the same as the
 *      M. `pricing.ts` owns how that resolves; nothing here duplicates it.
 *   2. **A variant is hard-deleted.** `OrderItem` keeps `variantSnapshot` and the price it
 *      was sold at, so removing a size the shop no longer stocks loses nothing an old
 *      order depended on. Its stock row goes with it by cascade — there is no shelf for a
 *      size that does not exist.
 *   3. **The first variant changes what the product's own stock figure means.** Once a
 *      kurta has an S and an M, the product-level row is not the count anyone wants, and
 *      `product.service.ts` stops showing it.
 */

import 'server-only';

import { isUniqueConstraintViolation, prisma } from '@/db/prisma';
import { ConflictError, NotFoundError } from '@/server/errors';
import { ensureStockRow } from '@/server/repositories/inventory.repository';
import {
  createVariant as createVariantRow,
  deleteVariant as deleteVariantRow,
  findVariantById,
  nextVariantPosition,
  updateVariant as updateVariantRow,
  variantSkuExists,
  type VariantRow,
  type VariantWriteFields,
} from '@/server/repositories/product.repository';
import {
  assertSaleBelowPrice,
  assertTouched,
  auditProduct,
  loadProductInWorkspace,
  toMinorOptional,
  type AuditMeta,
} from '@/server/services/product/product.internal';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  CreateVariantInput,
  DeleteVariantInput,
  UpdateVariantInput,
} from '@/server/validation/product';

/** Same reasoning as the product SKU: two variants sharing a code makes the shop's own
 *  stocktake ambiguous, and a refusal that does not say which code clashed is a dead
 *  end. */
async function assertVariantSkuFree(
  workspaceId: string,
  sku: string | null,
  exceptId?: string,
): Promise<void> {
  if (!sku) return;
  if (await variantSkuExists(prisma, workspaceId, sku, exceptId)) {
    throw new ConflictError(`Another variant already uses the code ${sku}.`);
  }
}

/**
 * Converts the two optional prices and enforces the sale rule between them.
 *
 * The comparison is against the *variant's own* price when it sets one, and against the
 * product's when it does not — the same inheritance `pricing.ts` applies when displaying
 * them. Comparing a variant's sale price against the product's price while the variant
 * overrides that price would accept a sale price above what the customer is actually
 * charged.
 */
function variantPrices(
  ctx: TenantContext,
  input: { priceMinor: string | null; salePriceMinor: string | null },
  productPriceMinor: number,
): { priceMinor: number | null; salePriceMinor: number | null } {
  const priceMinor = toMinorOptional(input.priceMinor, ctx.currency, 'priceMinor');
  const salePriceMinor = toMinorOptional(input.salePriceMinor, ctx.currency, 'salePriceMinor');

  assertSaleBelowPrice(priceMinor ?? productPriceMinor, salePriceMinor);

  return { priceMinor, salePriceMinor };
}

/** The non-money half of a variant, shared by create and update so the two cannot
 *  disagree about what a field means. */
type VariantLabels = {
  name: string | null;
  size: string | null;
  color: string | null;
  sku: string | null;
  status: VariantWriteFields['status'];
};

function writeFields(
  input: VariantLabels,
  prices: { priceMinor: number | null; salePriceMinor: number | null },
): VariantWriteFields {
  return {
    name: input.name,
    size: input.size,
    color: input.color,
    sku: input.sku,
    status: input.status,
    priceMinor: prices.priceMinor,
    salePriceMinor: prices.salePriceMinor,
  };
}

export async function createVariant(
  ctx: TenantContext,
  input: CreateVariantInput,
  meta?: AuditMeta,
): Promise<VariantRow> {
  requirePermission(ctx, 'product:update');

  // Confirms the parent is in this workspace before anything is written. The variant row
  // carries its own `workspaceId`, so this is the redundant layer — but it is the one that
  // catches a `productId` pointing at another tenant's catalogue, which the variant's own
  // scope has no way to notice.
  const product = await loadProductInWorkspace(ctx, input.productId);

  await assertVariantSkuFree(ctx.workspaceId, input.sku);
  const prices = variantPrices(ctx, input, product.priceMinor);
  const position = await nextVariantPosition(prisma, ctx.workspaceId, product.id);

  let created: VariantRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await createVariantRow(tx, {
        ...writeFields(input, prices),
        workspaceId: ctx.workspaceId,
        productId: product.id,
        position,
      });

      // Same reason as a new product: a variant with no stock row has no number for the
      // AI to quote, so it is never offered and the shop owner has no way to see why.
      await ensureStockRow(tx, ctx.workspaceId, product.id, row.id, {
        available: input.initialStock ?? 0,
      });

      return row;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError('That variant was just added by someone else on your team.');
    }
    throw error;
  }

  await auditProduct(
    ctx,
    'product.variant_created',
    'ProductVariant',
    created.id,
    { productId: product.id, size: created.size, color: created.color },
    meta,
  );

  return created;
}

export async function updateVariant(
  ctx: TenantContext,
  input: UpdateVariantInput,
  meta?: AuditMeta,
): Promise<VariantRow> {
  requirePermission(ctx, 'product:update');

  const existing = await findVariantById(prisma, ctx.workspaceId, input.variantId);
  if (!existing) throw new NotFoundError('Variant');

  // Reads the parent for its price, which is what an inherited sale price is measured
  // against, and confirms the parent is still in this workspace and not deleted.
  const product = await loadProductInWorkspace(ctx, existing.productId);

  await assertVariantSkuFree(ctx.workspaceId, input.sku, existing.id);
  const prices = variantPrices(ctx, input, product.priceMinor);

  try {
    assertTouched(
      await updateVariantRow(prisma, ctx.workspaceId, input.variantId, writeFields(input, prices)),
      'Variant',
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError('Another variant with that code was just saved.');
    }
    throw error;
  }

  await auditProduct(
    ctx,
    'product.variant_updated',
    'ProductVariant',
    input.variantId,
    prices.priceMinor === existing.priceMinor && prices.salePriceMinor === existing.salePriceMinor
      ? null
      : {
          productId: product.id,
          priceMinorBefore: existing.priceMinor,
          priceMinorAfter: prices.priceMinor,
          salePriceMinorBefore: existing.salePriceMinor,
          salePriceMinorAfter: prices.salePriceMinor,
          currency: product.currency,
        },
    meta,
  );

  // Re-read rather than merged from `existing`: the row the caller gets back has to carry
  // the database's `updatedAt`, and a locally reconstructed object would report the value
  // from before the write.
  const updated = await findVariantById(prisma, ctx.workspaceId, input.variantId);
  if (!updated) throw new NotFoundError('Variant');
  return updated;
}

/**
 * Removes the size or colour.
 *
 * Hard, unlike a product, for the reason in the module note: the order item keeps its own
 * snapshot. What is deliberately *not* checked is whether the variant has reserved stock
 * — an unconfirmed order holding two XLs. That check belongs with orders, which know what
 * a reservation means; refusing here on a number this service does not own would be a rule
 * enforced in the wrong place. Recorded as a gap rather than guessed at.
 */
export async function deleteVariant(
  ctx: TenantContext,
  input: DeleteVariantInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'product:update');

  const existing = await findVariantById(prisma, ctx.workspaceId, input.variantId);
  if (!existing) throw new NotFoundError('Variant');

  assertTouched(await deleteVariantRow(prisma, ctx.workspaceId, input.variantId), 'Variant');

  await auditProduct(
    ctx,
    'product.variant_deleted',
    'ProductVariant',
    input.variantId,
    { productId: existing.productId, size: existing.size, color: existing.color, sku: existing.sku },
    meta,
  );
}
