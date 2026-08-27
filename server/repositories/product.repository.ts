/**
 * Products, variants and images.
 *
 * Every function takes `workspaceId` and puts it in the `where` clause. Writes use
 * `updateMany` with the scope in the filter rather than `update` by id, because
 * `update` ignores the filter and would happily edit another tenant's row; a count of
 * zero is what the service turns into `NotFoundError`.
 *
 * Reads select `workspaceId` explicitly so `assertBelongsToWorkspace` has something to
 * check. Omitting it would make the post-read assertion unwritable, which is how the
 * third isolation layer quietly stops existing.
 *
 * Products are soft-deleted. `OrderItem.productId` is `SetNull` and carries its own
 * `nameSnapshot`, `skuSnapshot` and `unitPriceMinor`, so a hard delete would not corrupt
 * an old order — but it would erase the catalogue entry a business needs to reorder from,
 * and "delete" in a shop owner's hands means "take it off the list", not "destroy the
 * record". Every read filters `deletedAt: null`.
 *
 * Variants *are* hard-deleted, and the asymmetry is deliberate: the order item keeps its
 * `variantSnapshot` and its price, so removing a size that is no longer stocked loses
 * nothing that a past order depended on.
 *
 * Stock lives in `inventory.repository.ts`. Orders reserve and release it without going
 * anywhere near product editing, and keeping the two apart is what makes that possible.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
// A sibling in the same layer, imported one direction only. The low-stock predicate is
// a question about `inventory_items`, so it lives with the rest of stock rather than
// being written a second time here — two copies of that SQL would drift.
import { findLowStockProductIds } from '@/server/repositories/inventory.repository';
import type { ProductStatus } from '@/server/validation/product';

export type ProductRow = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  categoryId: string | null;
  status: ProductStatus;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  trackInventory: boolean;
  weightGrams: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Selected explicitly rather than with a bare `findMany`, so adding a column to
 *  Product cannot silently start shipping it to the browser. */
const PRODUCT_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  sku: true,
  description: true,
  categoryId: true,
  status: true,
  priceMinor: true,
  salePriceMinor: true,
  currency: true,
  trackInventory: true,
  weightGrams: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type VariantRow = {
  id: string;
  workspaceId: string;
  productId: string;
  sku: string | null;
  name: string | null;
  size: string | null;
  color: string | null;
  priceMinor: number | null;
  salePriceMinor: number | null;
  status: ProductStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

const VARIANT_SELECT = {
  id: true,
  workspaceId: true,
  productId: true,
  sku: true,
  name: true,
  size: true,
  color: true,
  priceMinor: true,
  salePriceMinor: true,
  status: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The stock figures a product list or detail page shows. Writing stock is the
 *  inventory repository's job; this is the read side, joined in so the list does not
 *  need a second round trip per product. */
export type ProductStockRow = {
  variantId: string | null;
  available: number;
  reserved: number;
  sold: number;
  lowStockThreshold: number;
};

const STOCK_SELECT = {
  variantId: true,
  available: true,
  reserved: true,
  sold: true,
  lowStockThreshold: true,
} as const;

export type ImageRow = {
  id: string;
  storageKey: string;
  alt: string | null;
  position: number;
};

export type ProductListRow = ProductRow & {
  categoryName: string | null;
  variantCount: number;
  stock: ProductStockRow[];
};

export type ProductDetailRow = ProductRow & {
  categoryName: string | null;
  variants: VariantRow[];
  stock: ProductStockRow[];
  images: ImageRow[];
};

export type ProductFilters = {
  search: string | null;
  status?: ProductStatus;
  categoryId?: string;
  lowStock?: boolean;
  cursor?: string;
  limit: number;
};

export type ProductPage = {
  rows: ProductListRow[];
  /** The id to pass back as `cursor` for the next page, or null at the end. */
  nextCursor: string | null;
};

/**
 * Builds the tenant-scoped filter for a list query.
 *
 * Private to this module: the `where` clause is the repository's business, and a
 * service that could hand one in would be able to hand in a workspace too.
 */
function buildWhere(
  workspaceId: string,
  filters: ProductFilters,
  lowStockIds: string[] | null,
): Record<string, unknown> {
  const where: Record<string, unknown> = { workspaceId, deletedAt: null };

  if (filters.status) where.status = filters.status;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (lowStockIds) where.id = { in: lowStockIds };

  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      // So a search for "black" finds the product whose only black thing is a
      // variant — which is how a shop owner thinks about their catalogue.
      { variants: { some: { color: { contains: term, mode: 'insensitive' } } } },
      { variants: { some: { size: { contains: term, mode: 'insensitive' } } } },
      { variants: { some: { sku: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  return where;
}

/**
 * One page of products, newest first.
 *
 * Ordered by `createdAt` with `id` as a tiebreaker: cursor pagination needs the sort to
 * end in something unique, or a row can appear on two consecutive pages.
 */
export async function listProducts(
  db: Db,
  workspaceId: string,
  filters: ProductFilters,
): Promise<ProductPage> {
  let lowStockIds: string[] | null = null;
  if (filters.lowStock) {
    lowStockIds = await findLowStockProductIds(db, workspaceId);
    // An empty `in` clause matches nothing, but saying so here saves the round trip
    // and makes the intent legible.
    if (lowStockIds.length === 0) return { rows: [], nextCursor: null };
  }

  const rows = await db.product.findMany({
    where: buildWhere(workspaceId, filters, lowStockIds),
    select: {
      ...PRODUCT_SELECT,
      category: { select: { name: true } },
      inventory: { select: STOCK_SELECT },
      _count: { select: { variants: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One more than asked for: its presence is how we know there is a next page
    // without a second COUNT over the same filter.
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    rows: page.map(({ category, inventory, _count, ...product }) => ({
      ...product,
      categoryName: category?.name ?? null,
      variantCount: _count.variants,
      stock: inventory,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function findProductById(
  db: Db,
  workspaceId: string,
  productId: string,
): Promise<ProductRow | null> {
  const row = await db.product.findFirst({
    where: { id: productId, workspaceId, deletedAt: null },
    select: PRODUCT_SELECT,
  });
  return (row as ProductRow | null) ?? null;
}

/** The product with everything the detail page and the AI's `get_product` tool need,
 *  in one query rather than four. */
export async function findProductDetail(
  db: Db,
  workspaceId: string,
  productId: string,
): Promise<ProductDetailRow | null> {
  const row = await db.product.findFirst({
    where: { id: productId, workspaceId, deletedAt: null },
    select: {
      ...PRODUCT_SELECT,
      category: { select: { name: true } },
      variants: { select: VARIANT_SELECT, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      inventory: { select: STOCK_SELECT },
      images: {
        select: { id: true, storageKey: true, alt: true, position: true },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!row) return null;

  const { category, variants, inventory, images, ...product } = row;
  return {
    ...product,
    categoryName: category?.name ?? null,
    variants: variants as VariantRow[],
    stock: inventory,
    images,
  };
}

/**
 * Whether a slug is already taken in this workspace.
 *
 * `exceptId` is for the edit case: a product keeps its own slug when its name has not
 * changed, and without the exclusion every save of an unrenamed product would collide
 * with itself. Includes soft-deleted rows, because `@@unique([workspaceId, slug])` does
 * not know about `deletedAt` — a slug freed only in our reading of it is still taken as
 * far as Postgres is concerned.
 */
export async function slugExists(
  db: Db,
  workspaceId: string,
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db.product.findFirst({
    where: { workspaceId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

/** Same reasoning as `slugExists`, for the SKU a shop owner types off a label. */
export async function skuExists(
  db: Db,
  workspaceId: string,
  sku: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db.product.findFirst({
    where: { workspaceId, sku, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

export async function countProducts(db: Db, workspaceId: string): Promise<number> {
  return db.product.count({ where: { workspaceId, deletedAt: null } });
}

export async function countProductsByStatus(
  db: Db,
  workspaceId: string,
): Promise<Record<string, number>> {
  const groups = await db.product.groupBy({
    by: ['status'],
    where: { workspaceId, deletedAt: null },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}

/**
 * The write shape.
 *
 * `priceMinor` and `salePriceMinor` are integers by the time they reach here — the
 * service converted them from what the person typed, and this layer never sees a
 * decimal string. `currency` is absent because it comes from the workspace and is set
 * once at creation; changing it would silently reinterpret every stored price.
 */
export type ProductWriteFields = {
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  categoryId: string | null;
  status: ProductStatus;
  priceMinor: number;
  salePriceMinor: number | null;
  trackInventory: boolean;
  weightGrams: number | null;
};

export async function createProduct(
  db: Db,
  input: ProductWriteFields & { workspaceId: string; currency: string },
): Promise<ProductRow> {
  const row = await db.product.create({ data: input, select: PRODUCT_SELECT });
  return row as ProductRow;
}

export async function updateProduct(
  db: Db,
  workspaceId: string,
  productId: string,
  data: Partial<ProductWriteFields>,
): Promise<number> {
  const result = await db.product.updateMany({
    where: { id: productId, workspaceId, deletedAt: null },
    data,
  });
  return result.count;
}

export async function softDeleteProduct(
  db: Db,
  workspaceId: string,
  productId: string,
  at: Date,
): Promise<number> {
  const result = await db.product.updateMany({
    where: { id: productId, workspaceId, deletedAt: null },
    data: { deletedAt: at },
  });
  return result.count;
}

// ── Variants ───────────────────────────────────────────────────────────────

export async function findVariantById(
  db: Db,
  workspaceId: string,
  variantId: string,
): Promise<VariantRow | null> {
  const row = await db.productVariant.findFirst({
    where: { id: variantId, workspaceId },
    select: VARIANT_SELECT,
  });
  return (row as VariantRow | null) ?? null;
}

export async function listVariants(
  db: Db,
  workspaceId: string,
  productId: string,
): Promise<VariantRow[]> {
  const rows = await db.productVariant.findMany({
    // Both ids in the filter. `productId` alone would be enough given it is a uuid,
    // but relying on that is relying on an attacker not guessing one.
    where: { workspaceId, productId },
    select: VARIANT_SELECT,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  return rows as VariantRow[];
}

export type VariantWriteFields = {
  name: string | null;
  size: string | null;
  color: string | null;
  sku: string | null;
  priceMinor: number | null;
  salePriceMinor: number | null;
  status: ProductStatus;
};

export async function createVariant(
  db: Db,
  input: VariantWriteFields & { workspaceId: string; productId: string; position: number },
): Promise<VariantRow> {
  const row = await db.productVariant.create({ data: input, select: VARIANT_SELECT });
  return row as VariantRow;
}

export async function updateVariant(
  db: Db,
  workspaceId: string,
  variantId: string,
  data: Partial<VariantWriteFields>,
): Promise<number> {
  const result = await db.productVariant.updateMany({
    where: { id: variantId, workspaceId },
    data,
  });
  return result.count;
}

/** Hard delete, unlike a product: the order item keeps its own snapshot of the
 *  variant's name and price, so nothing a past order relies on goes with it. */
export async function deleteVariant(
  db: Db,
  workspaceId: string,
  variantId: string,
): Promise<number> {
  const result = await db.productVariant.deleteMany({ where: { id: variantId, workspaceId } });
  return result.count;
}

/** The next `position` for a new variant, so sizes stay in the order they were added
 *  rather than in whatever order the database returns them. */
export async function nextVariantPosition(
  db: Db,
  workspaceId: string,
  productId: string,
): Promise<number> {
  const last = await db.productVariant.findFirst({
    where: { workspaceId, productId },
    select: { position: true },
    orderBy: { position: 'desc' },
  });
  return (last?.position ?? -1) + 1;
}

export async function variantSkuExists(
  db: Db,
  workspaceId: string,
  sku: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db.productVariant.findFirst({
    where: { workspaceId, sku, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

// ── Categories ─────────────────────────────────────────────────────────────

export type CategoryRow = { id: string; workspaceId: string; name: string; slug: string };

export async function listCategories(db: Db, workspaceId: string): Promise<CategoryRow[]> {
  return db.category.findMany({
    where: { workspaceId },
    select: { id: true, workspaceId: true, name: true, slug: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export async function findCategoryById(
  db: Db,
  workspaceId: string,
  categoryId: string,
): Promise<CategoryRow | null> {
  return db.category.findFirst({
    where: { id: categoryId, workspaceId },
    select: { id: true, workspaceId: true, name: true, slug: true },
  });
}
