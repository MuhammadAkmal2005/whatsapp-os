/**
 * What the caller may do to a customer record.
 *
 * A pure module, deliberately separate from the service. It is imported by three read
 * paths that had each built the same object inline, and three copies of an
 * authorization decision is three chances for one of them to drift — the copy that
 * drifts being, reliably, the one that grants too much.
 *
 * These flags exist so the UI can hide a control it would be refused anyway. They are
 * not the enforcement. Every mutating service function calls `requirePermission`
 * regardless of what was rendered, because a form post does not have to come from a
 * page we drew.
 */

import { can, type TenantContext } from '@/server/tenancy/context';

export type ContactCapability = {
  update: boolean;
  delete: boolean;
  /**
   * Handing a customer to a colleague is an update, not a permission of its own.
   *
   * It is named separately because the control is separate — the assignment picker is
   * not part of the details form — and because a future plan may well want to let an
   * agent hand a customer on without letting them rewrite the address. Keeping the
   * name means that change is one line here rather than a search for every caller.
   */
  assign: boolean;
};

export type ContactListCapability = {
  create: boolean;
  export: boolean;
};

export type ContactDetailCapability = ContactCapability & {
  /** A note is a write to the customer record, so it rides on `contact:update`. */
  addNote: boolean;
};

export function contactCapability(ctx: TenantContext): ContactCapability {
  const update = can(ctx, 'contact:update');
  return {
    update,
    delete: can(ctx, 'contact:delete'),
    assign: update,
  };
}

export function contactListCapability(ctx: TenantContext): ContactListCapability {
  return {
    create: can(ctx, 'contact:create'),
    export: can(ctx, 'contact:export'),
  };
}

export function contactDetailCapability(ctx: TenantContext): ContactDetailCapability {
  const capability = contactCapability(ctx);
  return { ...capability, addNote: capability.update };
}
