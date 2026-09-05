/**
 * What the caller may do to the knowledge a business has taught its assistant.
 *
 * A pure module for the reason `product.capability.ts` gives: the page and the table both
 * need the same answer, and two copies of an authorization decision is two chances for one
 * to drift — the one that drifts being reliably the one that grants too much.
 *
 * These flags exist so the UI can leave out a control that would be refused anyway. They
 * are not the enforcement. Every mutating function in the service calls
 * `requirePermission` regardless of what was rendered, because a form post does not have
 * to come from a page we drew.
 *
 * Retry is deliberately filed under update rather than given a permission of its own.
 * Pressing it does not change a word of what the business wrote — it re-runs processing
 * over text that is already stored — but it does consume the assistant's processing
 * budget, and a role trusted to spend that is exactly the role trusted to edit.
 */

import { can, type TenantContext } from '@/server/tenancy/context';

export type KnowledgeCapability = {
  create: boolean;
  update: boolean;
  delete: boolean;
  retry: boolean;
};

export function knowledgeCapability(ctx: TenantContext): KnowledgeCapability {
  const update = can(ctx, 'knowledge:update');

  return {
    create: can(ctx, 'knowledge:create'),
    update,
    delete: can(ctx, 'knowledge:delete'),
    retry: update,
  };
}
