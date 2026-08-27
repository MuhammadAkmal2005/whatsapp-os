/**
 * Shared internals for the product, variant and stock services.
 *
 * The product module is three services — the catalogue, its variants, and stock —
 * because they are edited from three different places and one file holding all of it
 * would be past the size where a missing tenant check stops being visible. They do share
 * four things, and sharing them here is what keeps the three consistent: a private
 * module is one definition, whereas "the same helper in three files" is three definitions
 * that agree until someone edits one.
 *
 * Not exported outside `server/services/product/`. Nothing here is a public service API.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { parseMoney } from '@/lib/money';
import { prisma } from '@/db/prisma';
import { NotFoundError, ValidationError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { findProductById, type ProductRow } from '@/server/repositories/product.repository';
import type { TenantContext } from '@/server/tenancy/context';

export type AuditMeta = { ipAddress?: string | null; userAgent?: string | null };

/** A zero row count from a workspace-scoped write means the id was not in this
 *  workspace. NotFound, never Forbidden — a 403 confirms the id exists elsewhere and
 *  turns the endpoint into an id oracle for another tenant's catalogue. */
export function assertTouched(count: number, what = 'Product'): void {
  if (count === 0) throw new NotFoundError(what);
}

/**
 * Turns the typed price into integer minor units, in the workspace's currency.
 *
 * This is the conversion `server/validation/product.ts` deliberately does not do, for the
 * reason recorded there: the schema cannot see which currency `3499` is in. Doing it here
 * means a Dubai seller's prices are not filed as rupees.
 *
 * The schema has already refined the same string through `parseMoney`, so a failure here
 * means the two disagreed — which is a bug rather than a typo. It still raises a
 * field-level `ValidationError` rather than throwing something opaque, because the person
 * on the other end of the form deserves to be told which box is wrong either way.
 */
export function toMinor(value: string, currency: TenantContext['currency'], field: string): number {
  const parsed = parseMoney(value, currency);
  if (!parsed) {
    throw new ValidationError('Please check the highlighted fields and try again.', {
      [field]: ['Enter an amount like 3499 or 3,499.50.'],
    });
  }
  return parsed.minor;
}

/** `toMinor` for a field that may legitimately be absent — a variant with no price
 *  override, or a product with no sale price. */
export function toMinorOptional(
  value: string | null | undefined,
  currency: TenantContext['currency'],
  field: string,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  return toMinor(value, currency, field);
}

/**
 * The sale-price rule, enforced where it counts.
 *
 * The schema checks this too, and that check is not sufficient: it compares the two
 * *strings the form submitted*, and a variant whose sale price is submitted alone is
 * being compared against nothing. Here both figures are integers in one currency, which
 * is the only place the comparison is unambiguous.
 *
 * Prisma's schema comment on `salePriceMinor` says "enforced in the service, not just the
 * UI". This is that enforcement.
 */
export function assertSaleBelowPrice(
  priceMinor: number,
  salePriceMinor: number | null,
  field = 'salePriceMinor',
): void {
  if (salePriceMinor === null) return;
  if (salePriceMinor < 0) {
    throw new ValidationError('Please check the highlighted fields and try again.', {
      [field]: ['A sale price cannot be negative.'],
    });
  }
  if (salePriceMinor >= priceMinor) {
    throw new ValidationError('Please check the highlighted fields and try again.', {
      [field]: ['The sale price has to be lower than the normal price.'],
    });
  }
}

/**
 * Confirms the product is in this workspace, and returns it.
 *
 * Every path that writes a *variant* or a *stock row* goes through here first. Those
 * tables carry their own `workspaceId` and the repositories filter on it, so this is the
 * redundant layer rather than the only one — but it is the layer that catches a variant
 * whose `productId` points at another tenant's product, which the variant's own scope
 * would not notice.
 */
export async function loadProductInWorkspace(
  ctx: TenantContext,
  productId: string,
): Promise<ProductRow> {
  const product = await findProductById(prisma, ctx.workspaceId, productId);
  if (!product) throw new NotFoundError('Product');
  return product;
}

/**
 * Records the action, and never fails the request over it.
 *
 * By the time this runs the product has been saved. Throwing here would discard
 * completed work and teach the person that saving is unreliable; a missing audit row is a
 * monitoring problem instead. Price changes in particular are logged with their before
 * and after, because "who dropped the price of the sherwani" is a question a business
 * will eventually need answered.
 */
export async function auditProduct(
  ctx: TenantContext,
  action: string,
  resourceType: 'Product' | 'ProductVariant' | 'InventoryItem',
  resourceId: string,
  metadata: Record<string, unknown> | null,
  meta?: AuditMeta,
): Promise<void> {
  try {
    await appendAuditLog(prisma, {
      action,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      resourceType,
      resourceId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata,
    });
  } catch (error) {
    logger.error('Failed to write product audit log', {
      action,
      resourceType,
      resourceId,
      workspaceId: ctx.workspaceId,
      error,
    });
  }
}
