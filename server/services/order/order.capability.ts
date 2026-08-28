/**
 * What the caller may do to an order.
 *
 * A pure module, separate from the service for the reason given in
 * `product.capability.ts`: several read paths need the same object, and copies of an
 * authorization decision drift — the copy that drifts being reliably the one that grants
 * too much.
 *
 * These flags let the UI hide a control it would be refused anyway. They are not the
 * enforcement. Every mutating service function calls `requirePermission` regardless of
 * what was rendered, because a form post does not have to come from a page we drew.
 *
 * The role split: an AGENT may create an order — a customer messages in, the agent
 * records what they want — but may not change its status, cancel it, or refund it. Those
 * are commercial decisions that belong to a MANAGER or above. This mirrors how the
 * permission catalogue is arranged.
 */

import { can, type TenantContext } from '@/server/tenancy/context';

export type OrderCapability = {
  update: boolean;
  updateStatus: boolean;
  cancel: boolean;
  refund: boolean;
  delete: boolean;
};

export type OrderListCapability = {
  create: boolean;
};

export function orderCapability(ctx: TenantContext): OrderCapability {
  return {
    update: can(ctx, 'order:update'),
    updateStatus: can(ctx, 'order:update_status'),
    cancel: can(ctx, 'order:cancel'),
    refund: can(ctx, 'order:refund'),
    delete: can(ctx, 'order:delete'),
  };
}

export function orderListCapability(ctx: TenantContext): OrderListCapability {
  return { create: can(ctx, 'order:create') };
}
