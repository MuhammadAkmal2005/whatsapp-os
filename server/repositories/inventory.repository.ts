/**
 * Stock.
 *
 * Separate from `product.repository.ts` because stock is written by two very different
 * callers. A shop owner edits it from the product page; an order reserves it, releases
 * it on cancellation and converts it to `sold` on fulfilment. Keeping them apart means
 * the order path never imports product editing.
 *
 * Four numbers per row, and the distinction between them is the whole point:
 *
 *   available          — can be sold right now. This is the number the AI is allowed
 *                        to quote, and it is why a customer is not told "yes" about a
 *                        kurta that is already inside someone else's unpaid order.
 *   reserved           — held by an unconfirmed order.
 *   sold               — fulfilled. Kept rather than discarded so a business can see
 *                        what actually moved.
 *   lowStockThreshold  — per row, because 3 is right for a wedding sherwani and 50 is
 *                        right for plain socks.
 *
 * **Every mutation here is atomic and guarded.** Adjustments use Prisma's `increment`
 * and `decrement` so the database does the arithmetic, and the ones that could go
 * negative carry a `gte` filter in the `where` clause. Reading a value, adding to it in
 * JavaScript and writing it back would lose an update the moment two orders for the
 * last shirt arrive together — which is exactly when it matters.
 *
 * A returned count of zero therefore means one of two things: no such row in this
 * workspace, or not enough stock. The service disambiguates by reading the row, which
 * is a cheap second query on a path that has already been refused.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type StockRow = {
  id: string;
  workspaceId: string;
  productId: string;
  variantId: string | null;
  available: number;
  reserved: number;
  sold: number;
  lowStockThreshold: number;
  updatedAt: Date;
};

const STOCK_SELECT = {
  id: true,
  workspaceId: true,
  productId: true,
  variantId: true,
  available: true,
  reserved: true,
  sold: true,
  lowStockThreshold: true,
  updatedAt: true,
} as const;

/**
 * The row for a product or one of its variants.
 *
 * `variantId: null` addresses the product-level row — a product with no variants at
 * all, where the stock figure belongs to the product itself. Passing `undefined` here
 * would match *any* row for the product, so the parameter is deliberately required and
 * explicitly nullable rather than optional.
 */
export async function findStock(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
): Promise<StockRow | null> {
  const row = await db.inventoryItem.findFirst({
    where: { workspaceId, productId, variantId },
    select: STOCK_SELECT,
  });
  return (row as StockRow | null) ?? null;
}

export async function listStockForProduct(
  db: Db,
  workspaceId: string,
  productId: string,
): Promise<StockRow[]> {
  const rows = await db.inventoryItem.findMany({
    where: { workspaceId, productId },
    select: STOCK_SELECT,
  });
  return rows as StockRow[];
}

/**
 * Creates the row if it is missing, and leaves it alone if it is not.
 *
 * Not an `upsert`, and the reason is a real gap in the schema rather than a preference:
 * `InventoryItem.variantId` is unique, so a variant row could be upserted, but there is
 * no unique constraint covering the product-level row where `variantId IS NULL`. Prisma
 * has no unique key to name, so this is a find-then-create.
 *
 * That makes it racy under concurrency: two requests could both find nothing and both
 * insert, leaving a product with two stock rows and an `available` figure that depends
 * on which one a later query happens to read. The window is small and both callers today
 * are a single shop owner saving a form, so the exposure is low — but it is a real
 * defect, the fix is a partial unique index on `(productId) WHERE variantId IS NULL`,
 * and it is recorded in `docs/ROADMAP.md` rather than left for someone to discover from
 * a stock figure that will not stay still.
 */
export async function ensureStockRow(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  defaults?: { available?: number; lowStockThreshold?: number },
): Promise<StockRow> {
  const existing = await findStock(db, workspaceId, productId, variantId);
  if (existing) return existing;

  const row = await db.inventoryItem.create({
    data: {
      workspaceId,
      productId,
      variantId,
      available: defaults?.available ?? 0,
      ...(defaults?.lowStockThreshold === undefined
        ? {}
        : { lowStockThreshold: defaults.lowStockThreshold }),
    },
    select: STOCK_SELECT,
  });
  return row as StockRow;
}

/**
 * A stocktake: the person has counted what is on the shelf.
 *
 * Absolute, and therefore last-write-wins, which is correct here — a count performed
 * five minutes ago should not be added to a count performed now. `reserved` is left
 * alone: units inside an unconfirmed order are not on the shelf and were not counted.
 */
export async function setAvailable(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  available: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: { workspaceId, productId, variantId },
    data: { available },
  });
  return result.count;
}

/**
 * A movement: units arrived, or were damaged, or were given away.
 *
 * Relative, so two people recording two deliveries at the same time both count. The
 * `gte` guard on a reduction is what stops `available` going negative — a floor
 * enforced by the same statement that does the arithmetic, rather than by a check that
 * another request can slip between.
 */
export async function adjustAvailable(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: {
      workspaceId,
      productId,
      variantId,
      ...(delta < 0 ? { available: { gte: -delta } } : {}),
    },
    data: { available: { increment: delta } },
  });
  return result.count;
}

export async function setLowStockThreshold(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  lowStockThreshold: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: { workspaceId, productId, variantId },
    data: { lowStockThreshold },
  });
  return result.count;
}

/**
 * Moves units from available to reserved for an order that is not yet confirmed.
 *
 * The `available: { gte: quantity }` filter is the oversell guard, and it lives in the
 * `where` clause on purpose. A service that checked stock and then reserved it would
 * sell the last shirt twice to two customers who messaged in the same second; here the
 * second statement simply matches no rows and returns zero.
 */
export async function reserveStock(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  quantity: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: { workspaceId, productId, variantId, available: { gte: quantity } },
    data: { available: { decrement: quantity }, reserved: { increment: quantity } },
  });
  return result.count;
}

/** Puts a cancelled order's units back on the shelf. Guarded on `reserved` so a double
 *  cancellation cannot invent stock the business does not have. */
export async function releaseStock(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  quantity: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: { workspaceId, productId, variantId, reserved: { gte: quantity } },
    data: { reserved: { decrement: quantity }, available: { increment: quantity } },
  });
  return result.count;
}

/** Fulfilment: reserved units have left the building. They do not return to
 *  `available`, which is the difference between this and `releaseStock`. */
export async function markSold(
  db: Db,
  workspaceId: string,
  productId: string,
  variantId: string | null,
  quantity: number,
): Promise<number> {
  const result = await db.inventoryItem.updateMany({
    where: { workspaceId, productId, variantId, reserved: { gte: quantity } },
    data: { reserved: { decrement: quantity }, sold: { increment: quantity } },
  });
  return result.count;
}

/**
 * The ids of products with any stock row at or below its own threshold.
 *
 * Raw SQL because the predicate compares two columns of the same row, per row: a
 * threshold of 3 on one product and 50 on another are both correct. Prisma's `where`
 * takes values rather than column references, and expressing this through the query
 * builder would mean relying on the field-reference API without being able to read the
 * generated client's types from this environment. One line of unambiguous SQL beats a
 * plausible-looking call that might not exist.
 *
 * `workspaceId` is a bound parameter rather than interpolated, so this is no more
 * injectable than the builder would be.
 */
export async function findLowStockProductIds(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ product_id: string }[]>`
    SELECT DISTINCT "productId" AS product_id
    FROM inventory_items
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND available <= "lowStockThreshold"
  `;
  return rows.map((row) => row.product_id);
}

/** How many products are running low — the dashboard alert, which needs a number
 *  rather than the rows. */
export async function countLowStockProducts(db: Db, workspaceId: string): Promise<number> {
  const ids = await findLowStockProductIds(db, workspaceId);
  return ids.length;
}
