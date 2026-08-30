/**
 * Product service.
 *
 * Where authorization for the catalogue happens, and where a typed price becomes an
 * integer. The CRUD is not the interesting part. These five things are, and each one
 * fails quietly if nobody writes it down:
 *
 *   1. **Money is converted here, in the workspace's currency.** The schema kept the
 *      price as a string on purpose — it cannot know whether `3499` is rupees or dirhams.
 *      `ctx.currency` can, so the conversion belongs at this layer and nowhere else.
 *   2. **The sale price is checked against the price as integers.** The schema compares
 *      two form strings, which is not the same comparison and is unavailable when only
 *      one of the two was submitted.
 *   3. **The slug is derived, and collisions are resolved by suffixing.** Two products
 *      both called "Black Kurta" is entirely normal in a real shop; a failed save over it
 *      would not be.
 *   4. **A new product gets its stock row in the same transaction.** A product with no
 *      row reads as unknown rather than as zero, and the AI cannot quote a number that
 *      does not exist — so the product would silently never be offered.
 *   5. **The plan limit is checked against live rows**, so a business at its ceiling is
 *      told the number rather than shown a failed save.
 */

import 'server-only';

import { getPlan } from '@/config/plans';
import { isUniqueConstraintViolation, prisma } from '@/db/prisma';
import { slugify, slugSuffix } from '@/lib/ids';
import { ConflictError, LimitExceededError, NotFoundError } from '@/server/errors';
import { ensureStockRow } from '@/server/repositories/inventory.repository';
import { assertWithinPlanLimit } from '@/server/services/billing/limit-guard.service';
import {
  countProducts,
  countProductsByStatus,
  createProduct as createProductRow,
  findProductDetail,
  listCategories,
  listProducts,
  skuExists,
  slugExists,
  softDeleteProduct,
  updateProduct as updateProductRow,
  type CategoryRow,
  type ImageRow,
  type ProductDetailRow,
  type ProductListRow,
  type ProductRow,
  type ProductStockRow,
  type ProductWriteFields,
  type VariantRow,
} from '@/server/repositories/product.repository';
import {
  productCapability,
  productDetailCapability,
  productListCapability,
  type ProductCapability,
  type ProductDetailCapability,
  type ProductListCapability,
} from '@/server/services/product/product.capability';
import {
  assertSaleBelowPrice,
  assertTouched,
  auditProduct,
  loadProductInWorkspace,
  toMinor,
  toMinorOptional,
  type AuditMeta,
} from '@/server/services/product/product.internal';
import { resolvePrice, type ResolvedPrice } from '@/server/services/product/pricing';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  CreateProductInput,
  DeleteProductInput,
  ListProductsInput,
  SetProductStatusInput,
  UpdateProductInput,
} from '@/server/validation/product';

/** Stock as a page renders it. `isLow` is derived rather than stored, because the
 *  threshold is per row and a UI that recomputed it would drift from the list filter. */
export type ProductStock = ProductStockRow & { isLow: boolean };

export type ProductSummary = ProductRow & {
  categoryName: string | null;
  variantCount: number;
  price: ResolvedPrice;
  /** Across the product row and every variant row, so a kurta with 3 smalls and 4
   *  larges reads as 7 rather than as whichever row came back first. */
  totalAvailable: number;
  isLowStock: boolean;
  /** Absent when the product does not track inventory at all — a made-to-order
   *  sherwani has no shelf to count. Distinct from zero, which means sold out. */
  tracksStock: boolean;
  can: ProductCapability;
};

export type ProductVariantView = VariantRow & {
  price: ResolvedPrice;
  stock: ProductStock | null;
};

export type ProductDetail = ProductRow & {
  categoryName: string | null;
  price: ResolvedPrice;
  variants: ProductVariantView[];
  /** The product-level row, present only when the product has no variants of its own.
   *  A product with variants counts stock per variant. */
  ownStock: ProductStock | null;
  images: ImageRow[];
  totalAvailable: number;
  isLowStock: boolean;
  tracksStock: boolean;
  can: ProductDetailCapability;
};

export type ProductListPage = {
  products: ProductSummary[];
  nextCursor: string | null;
  statusCounts: Record<string, number>;
  /** Live row count against the plan ceiling, so the page can warn before a save fails
   *  rather than after. */
  usage: { used: number; limit: number | null };
  categories: CategoryRow[];
  can: ProductListCapability;
};

function toStock(row: ProductStockRow): ProductStock {
  return { ...row, isLow: row.available <= row.lowStockThreshold };
}

function totalAvailable(rows: readonly ProductStockRow[]): number {
  return rows.reduce((running, row) => running + row.available, 0);
}

/** A product is "running low" when *any* of its rows is, which matches the question a
 *  shop owner is asking: they need to reorder the size that has run out, not wait for
 *  the whole style to. Untracked products are never low — there is nothing to run out
 *  of, and flagging them would train the person to ignore the badge. */
function isLowStock(product: { trackInventory: boolean }, rows: readonly ProductStockRow[]): boolean {
  if (!product.trackInventory) return false;
  return rows.some((row) => row.available <= row.lowStockThreshold);
}

function toSummary(row: ProductListRow, can: ProductCapability): ProductSummary {
  const { categoryName, variantCount, stock, ...product } = row;
  return {
    ...product,
    categoryName,
    variantCount,
    price: resolvePrice(product),
    totalAvailable: totalAvailable(stock),
    isLowStock: isLowStock(product, stock),
    tracksStock: product.trackInventory,
    can,
  };
}

function toDetail(row: ProductDetailRow, can: ProductDetailCapability): ProductDetail {
  const { categoryName, variants, stock, images, ...product } = row;

  const byVariant = new Map<string, ProductStockRow>();
  let own: ProductStockRow | null = null;
  for (const entry of stock) {
    if (entry.variantId === null) own = entry;
    else byVariant.set(entry.variantId, entry);
  }

  // Which rows the headline figures count. A product with variants is counted per
  // variant, so its own row — which `createProduct` always writes — would otherwise be
  // added on top and report stock the shop does not have.
  const counted = variants.length === 0 ? stock : stock.filter((entry) => entry.variantId !== null);

  return {
    ...product,
    categoryName,
    price: resolvePrice(product),
    variants: variants.map((variant) => {
      const variantStock = byVariant.get(variant.id) ?? null;
      return {
        ...variant,
        price: resolvePrice(product, variant),
        stock: variantStock ? toStock(variantStock) : null,
      };
    }),
    ownStock: variants.length === 0 && own ? toStock(own) : null,
    images,
    totalAvailable: totalAvailable(counted),
    isLowStock: isLowStock(product, counted),
    tracksStock: product.trackInventory,
    can,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getProducts(
  ctx: TenantContext,
  input: ListProductsInput,
): Promise<ProductListPage> {
  requirePermission(ctx, 'product:read');

  const [page, statusCounts, used, categories] = await Promise.all([
    listProducts(prisma, ctx.workspaceId, {
      search: input.search,
      ...(input.status ? { status: input.status } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      lowStock: input.lowStock,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit,
    }),
    countProductsByStatus(prisma, ctx.workspaceId),
    countProducts(prisma, ctx.workspaceId),
    listCategories(prisma, ctx.workspaceId),
  ]);

  const can = productCapability(ctx);

  return {
    products: page.rows.map((row) => toSummary(row, can)),
    nextCursor: page.nextCursor,
    statusCounts,
    usage: { used, limit: getPlan(ctx.planKey).limits.products },
    categories,
    can: productListCapability(ctx),
  };
}

export async function getProduct(ctx: TenantContext, productId: string): Promise<ProductDetail> {
  requirePermission(ctx, 'product:read');

  const row = await findProductDetail(prisma, ctx.workspaceId, productId);
  // The repository filtered on `workspaceId`, so a miss here is either a product that
  // does not exist or one belonging to another tenant. Both answer the same way — telling
  // the two apart is precisely what an id oracle is.
  if (!row) throw new NotFoundError('Product');

  return toDetail(row, productDetailCapability(ctx));
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * A slug nobody has to think about.
 *
 * Two products called "Black Kurta" is ordinary in a real shop — one cotton, one lawn —
 * so a collision is a normal outcome to be resolved rather than an error to report. The
 * loop is bounded: after five attempts the suffix stops being a readability nicety and a
 * random one is fine, and an unbounded loop against a `slugExists` query is a way to hang
 * a request.
 */
async function resolveSlug(
  workspaceId: string,
  name: string,
  exceptId?: string,
): Promise<string> {
  // A name written entirely in Urdu script reduces to an empty slug, which would collide
  // with every other such product. `workspaceSlug` solves the same problem the same way.
  const base = slugify(name) || 'product';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${slugSuffix()}`;
    if (!(await slugExists(prisma, workspaceId, candidate, exceptId))) return candidate;
  }
  return `${base}-${slugSuffix()}-${slugSuffix()}`;
}

/** The SKU is what a shop owner reads off a label, and two products sharing one makes
 *  their own stocktake ambiguous. Refused with the name of the product already using it,
 *  because "SKU already exists" without saying where is a dead end. */
async function assertSkuFree(
  workspaceId: string,
  sku: string | null,
  exceptId?: string,
): Promise<void> {
  if (!sku) return;
  if (await skuExists(prisma, workspaceId, sku, exceptId)) {
    throw new ConflictError(`Another product already uses the code ${sku}.`);
  }
}

/** Maps validated input onto the columns, converting money on the way. Shared by create
 *  and update so the two cannot disagree about what a field means. */
function writeFields(
  ctx: TenantContext,
  input: Omit<CreateProductInput, 'initialStock' | 'lowStockThreshold'> | Omit<UpdateProductInput, 'productId'>,
  slug: string,
): ProductWriteFields {
  const priceMinor = toMinor(input.priceMinor, ctx.currency, 'priceMinor');
  const salePriceMinor = toMinorOptional(input.salePriceMinor, ctx.currency, 'salePriceMinor');
  assertSaleBelowPrice(priceMinor, salePriceMinor);

  return {
    name: input.name,
    slug,
    sku: input.sku,
    description: input.description,
    categoryId: input.categoryId,
    status: input.status,
    priceMinor,
    salePriceMinor,
    trackInventory: input.trackInventory,
    weightGrams: input.weightGrams ?? null,
  };
}

export async function createProduct(
  ctx: TenantContext,
  input: CreateProductInput,
  meta?: AuditMeta,
): Promise<ProductDetail> {
  requirePermission(ctx, 'product:create');

  await assertWithinPlanLimit(ctx, 'products', 1, prisma);

  await assertSkuFree(ctx.workspaceId, input.sku);
  const slug = await resolveSlug(ctx.workspaceId, input.name);
  const fields = writeFields(ctx, input, slug);

  let created: ProductRow;
  try {
    // One transaction, because a product without a stock row is invisible to the AI: it
    // has no number to quote, so it declines to offer the product and the shop owner sees
    // a save that appeared to work and a kurta nobody is ever told about.
    created = await prisma.$transaction(async (tx) => {
      const row = await createProductRow(tx, {
        ...fields,
        workspaceId: ctx.workspaceId,
        currency: ctx.currency,
      });

      await ensureStockRow(tx, ctx.workspaceId, row.id, null, {
        available: input.initialStock ?? 0,
        ...(input.lowStockThreshold === undefined
          ? {}
          : { lowStockThreshold: input.lowStockThreshold }),
      });

      return row;
    });
  } catch (error) {
    // Lost the race against a concurrent insert on the same slug or SKU. The checks
    // above narrow this to a genuine collision rather than a 500.
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError('That product was just saved by someone else on your team.');
    }
    throw error;
  }

  await auditProduct(ctx, 'product.created', 'Product', created.id, {
    name: created.name,
    priceMinor: created.priceMinor,
    currency: created.currency,
  }, meta);

  return getProduct(ctx, created.id);
}

export async function updateProduct(
  ctx: TenantContext,
  input: UpdateProductInput,
  meta?: AuditMeta,
): Promise<ProductDetail> {
  requirePermission(ctx, 'product:update');

  const existing = await loadProductInWorkspace(ctx, input.productId);

  await assertSkuFree(ctx.workspaceId, input.sku, existing.id);

  // The slug follows the name, and only when the name actually changed: re-deriving it on
  // every save would hand a renamed-and-renamed-back product a suffix it did not earn.
  const slug =
    input.name === existing.name
      ? existing.slug
      : await resolveSlug(ctx.workspaceId, input.name, existing.id);

  const fields = writeFields(ctx, input, slug);

  try {
    assertTouched(await updateProductRow(prisma, ctx.workspaceId, input.productId, fields));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError('Another product with that name or code was just saved.');
    }
    throw error;
  }

  // Price changes are logged with both figures. "Who dropped the price of the sherwani,
  // and from what" is a question a business eventually needs answered, and an audit row
  // recording only that an update happened cannot answer it.
  await auditProduct(
    ctx,
    'product.updated',
    'Product',
    input.productId,
    fields.priceMinor === existing.priceMinor && fields.salePriceMinor === existing.salePriceMinor
      ? null
      : {
          priceMinorBefore: existing.priceMinor,
          priceMinorAfter: fields.priceMinor,
          salePriceMinorBefore: existing.salePriceMinor,
          salePriceMinorAfter: fields.salePriceMinor,
          currency: existing.currency,
        },
    meta,
  );

  return getProduct(ctx, input.productId);
}

/** The quick toggle on the list row. Separate from `updateProduct` because taking a
 *  sold-out style off the catalogue should not require a trip through the pricing form. */
export async function setProductStatus(
  ctx: TenantContext,
  input: SetProductStatusInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'product:update');

  assertTouched(
    await updateProductRow(prisma, ctx.workspaceId, input.productId, { status: input.status }),
  );
  await auditProduct(ctx, 'product.status_changed', 'Product', input.productId, {
    status: input.status,
  }, meta);
}

/**
 * Takes the product off the catalogue.
 *
 * Soft, and the reason is not squeamishness about deletion. `OrderItem` keeps its own
 * snapshot of the name, code and price it was sold at, so a hard delete would not corrupt
 * an old order — but it would erase the catalogue entry the business reorders from, and
 * "delete" in a shop owner's hands means "take it off the list", not "destroy the record".
 * Stock rows are left in place, so restoring the product restores its count too.
 */
export async function deleteProduct(
  ctx: TenantContext,
  input: DeleteProductInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'product:delete');

  const existing = await loadProductInWorkspace(ctx, input.productId);

  assertTouched(await softDeleteProduct(prisma, ctx.workspaceId, input.productId, new Date()));
  await auditProduct(ctx, 'product.deleted', 'Product', input.productId, {
    name: existing.name,
    sku: existing.sku,
  }, meta);
}
