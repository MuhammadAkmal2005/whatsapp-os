/**
 * What the caller may do to a product.
 *
 * A pure module, separate from the service for the reason given in
 * `contact.capability.ts`: several read paths need the same object, and three copies of
 * an authorization decision is three chances for one to drift — the copy that drifts
 * being reliably the one that grants too much.
 *
 * These flags let the UI hide a control it would be refused anyway. They are not the
 * enforcement. Every mutating service function calls `requirePermission` regardless of
 * what was rendered, because a form post does not have to come from a page we drew.
 *
 * The role split differs from customers, and the difference is intentional. An AGENT may
 * create a *customer* — someone messages in, the agent records them — but holds only
 * `product:read` and `inventory:read`. A price is a commercial decision, and stock is the
 * number the AI quotes to customers; an agent who could quietly change either could
 * discount or oversell the whole catalogue from a chat window.
 */

import { can, type TenantContext } from '@/server/tenancy/context';

export type ProductCapability = {
  update: boolean;
  delete: boolean;
  /**
   * Stock has its own permission, `inventory:update`, rather than riding on
   * `product:update`.
   *
   * They happen to move together in the current role matrix — MANAGER has both, AGENT
   * has neither — but they are different decisions. Counting shirts is not repricing
   * them, and a shop that wants an assistant who can do the first without the second
   * needs the two permissions to already be distinct.
   */
  editStock: boolean;
};

export type ProductListCapability = {
  create: boolean;
};

export type ProductDetailCapability = ProductCapability & {
  /** Adding, editing or removing a size or colour is a write to the product. */
  editVariants: boolean;
};

export function productCapability(ctx: TenantContext): ProductCapability {
  return {
    update: can(ctx, 'product:update'),
    delete: can(ctx, 'product:delete'),
    editStock: can(ctx, 'inventory:update'),
  };
}

export function productListCapability(ctx: TenantContext): ProductListCapability {
  return { create: can(ctx, 'product:create') };
}

export function productDetailCapability(ctx: TenantContext): ProductDetailCapability {
  const capability = productCapability(ctx);
  return { ...capability, editVariants: capability.update };
}
