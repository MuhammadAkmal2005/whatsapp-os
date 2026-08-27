/**
 * Stock service.
 *
 * Three operations, and the difference between the first two is the whole reason this
 * file exists separately from the product form:
 *
 *   `setStock`    — a stocktake. "There are 27 on the shelf." Absolute, last-write-wins,
 *                   which is right for a count someone has just performed.
 *   `adjustStock` — a movement. "12 arrived", "2 were damaged". Relative, so two people
 *                   recording two deliveries at the same moment both count.
 *
 * A form that offered only one of these would be wrong half the time, and the half it got
 * wrong would silently lose a delivery.
 *
 * The guarantees live in the repository, not here: every mutation is a single guarded
 * `updateMany`, so the floor at zero is enforced by the same statement that does the
 * arithmetic. What this layer adds is authorization, the workspace check on the parent
 * product, and turning a zero row count into a sentence a shop owner can act on.
 *
 * `reserved` and `sold` are deliberately not editable here. They are moved by the order
 * lifecycle, and a hand-edit would decouple the shelf from the order book — the business
 * would see stock it has already promised to someone.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { BusinessRuleError } from '@/server/errors';
import {
  adjustAvailable,
  ensureStockRow,
  findStock,
  listStockForProduct,
  setAvailable,
  setLowStockThreshold as setThresholdRow,
  type StockRow,
} from '@/server/repositories/inventory.repository';
import { findVariantById } from '@/server/repositories/product.repository';
import {
  auditProduct,
  loadProductInWorkspace,
  type AuditMeta,
} from '@/server/services/product/product.internal';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  AdjustStockInput,
  SetLowStockThresholdInput,
  SetStockInput,
} from '@/server/validation/product';

/**
 * Confirms the product — and the variant, when one is named — belongs to this workspace,
 * then makes sure there is a row to write to.
 *
 * The variant check is not redundant with the product check. A `variantId` from one tenant
 * paired with a `productId` from another would pass a scope test on each id separately;
 * what has to be verified is that the variant belongs to *this* product. Without that, a
 * stock write could be aimed at a row the caller has no business touching.
 */
async function resolveTarget(
  ctx: TenantContext,
  productId: string,
  variantId: string | null,
): Promise<StockRow> {
  await loadProductInWorkspace(ctx, productId);

  if (variantId !== null) {
    const variant = await findVariantById(prisma, ctx.workspaceId, variantId);
    if (!variant || variant.productId !== productId) {
      throw new BusinessRuleError('That size or colour is not part of this product.');
    }
  }

  // Created on demand rather than assumed: a product added before stock tracking was
  // switched on has no row, and refusing the shop owner's first stocktake over that would
  // be a dead end they cannot get out of.
  return ensureStockRow(prisma, ctx.workspaceId, productId, variantId);
}

/** The row was there a statement ago and is not now — someone removed the variant while
 *  a colleague was counting it. Rare, real, and not a 500. */
const STOCK_ROW_GONE = 'That stock record no longer exists. Reload and try again.';

export type StockView = StockRow & { isLow: boolean };

function toView(row: StockRow): StockView {
  return { ...row, isLow: row.available <= row.lowStockThreshold };
}

export async function getStockForProduct(
  ctx: TenantContext,
  productId: string,
): Promise<StockView[]> {
  requirePermission(ctx, 'inventory:read');

  await loadProductInWorkspace(ctx, productId);
  const rows = await listStockForProduct(prisma, ctx.workspaceId, productId);
  return rows.map(toView);
}

/** A stocktake. `reserved` is left alone on purpose: units inside an unconfirmed order
 *  are not on the shelf and were not part of what the person counted. */
export async function setStock(
  ctx: TenantContext,
  input: SetStockInput,
  meta?: AuditMeta,
): Promise<StockView> {
  requirePermission(ctx, 'inventory:update');

  const variantId = input.variantId ?? null;
  const before = await resolveTarget(ctx, input.productId, variantId);

  const count = await setAvailable(
    prisma,
    ctx.workspaceId,
    input.productId,
    variantId,
    input.available,
  );
  // `resolveTarget` just created or found the row, so a miss here means it was deleted
  // between the two statements — a real outcome when someone removes a variant while a
  // colleague is counting it.
  if (count === 0) throw new BusinessRuleError(STOCK_ROW_GONE);

  await auditProduct(
    ctx,
    'inventory.counted',
    'InventoryItem',
    before.id,
    { productId: input.productId, variantId, availableBefore: before.available, availableAfter: input.available },
    meta,
  );

  return readBack(ctx, input.productId, variantId);
}

/**
 * A movement.
 *
 * A reduction is guarded on `available` inside the same statement, so a request to remove
 * more than exists matches no rows and returns zero rather than driving the shelf negative.
 * That is reported as what it is — the person tried to write off stock the shop does not
 * have — with the figure that is actually there, because "not enough stock" without the
 * number is a message that cannot be acted on.
 */
export async function adjustStock(
  ctx: TenantContext,
  input: AdjustStockInput,
  meta?: AuditMeta,
): Promise<StockView> {
  requirePermission(ctx, 'inventory:update');

  const variantId = input.variantId ?? null;
  const before = await resolveTarget(ctx, input.productId, variantId);

  const count = await adjustAvailable(
    prisma,
    ctx.workspaceId,
    input.productId,
    variantId,
    input.delta,
  );

  if (count === 0) {
    // Re-read rather than trusting `before`: between the two statements a concurrent order
    // may have taken the stock, and quoting a figure from before that happened would tell
    // the person a number they can no longer see on screen.
    const current = await findStock(prisma, ctx.workspaceId, input.productId, variantId);
    throw new BusinessRuleError(
      current
        ? `There ${current.available === 1 ? 'is' : 'are'} only ${current.available} available, so ${Math.abs(input.delta)} cannot be removed.`
        : STOCK_ROW_GONE,
    );
  }

  await auditProduct(
    ctx,
    'inventory.adjusted',
    'InventoryItem',
    before.id,
    { productId: input.productId, variantId, delta: input.delta, reason: input.reason },
    meta,
  );

  return readBack(ctx, input.productId, variantId);
}

/** Per row, because 3 is the right alert level for a wedding sherwani and 50 is right
 *  for plain socks. */
export async function setLowStockThreshold(
  ctx: TenantContext,
  input: SetLowStockThresholdInput,
  meta?: AuditMeta,
): Promise<StockView> {
  requirePermission(ctx, 'inventory:update');

  const variantId = input.variantId ?? null;
  const before = await resolveTarget(ctx, input.productId, variantId);

  const count = await setThresholdRow(
    prisma,
    ctx.workspaceId,
    input.productId,
    variantId,
    input.lowStockThreshold,
  );
  if (count === 0) throw new BusinessRuleError(STOCK_ROW_GONE);

  await auditProduct(
    ctx,
    'inventory.threshold_changed',
    'InventoryItem',
    before.id,
    { productId: input.productId, variantId, lowStockThreshold: input.lowStockThreshold },
    meta,
  );

  return readBack(ctx, input.productId, variantId);
}

/** The row as it stands after the write, so the caller renders the database's figure
 *  rather than the one it hoped for. */
async function readBack(
  ctx: TenantContext,
  productId: string,
  variantId: string | null,
): Promise<StockView> {
  const row = await findStock(prisma, ctx.workspaceId, productId, variantId);
  if (!row) throw new BusinessRuleError(STOCK_ROW_GONE);
  return toView(row);
}
