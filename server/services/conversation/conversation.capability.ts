/**
 * Conversation capability module.
 *
 * Computes pure capability objects for the caller based on their TenantContext role
 * and permissions, allowing the UI to render appropriate actions while the service
 * layer enforces them.
 */

import { can, type TenantContext } from '@/server/tenancy/context';

export type ConversationCapability = {
  reply: boolean;
  assign: boolean;
  updateStatus: boolean;
  toggleAi: boolean;
  delete: boolean;
};

export type ConversationListCapability = {
  create: boolean;
  readAll: boolean;
};

export type ConversationDetailCapability = ConversationCapability & {
  sendTemplate: boolean;
};

export function conversationCapability(ctx: TenantContext): ConversationCapability {
  return {
    reply: can(ctx, 'conversation:reply'),
    assign: can(ctx, 'conversation:assign'),
    updateStatus: can(ctx, 'conversation:update_status'),
    toggleAi: can(ctx, 'conversation:toggle_ai'),
    delete: can(ctx, 'conversation:delete'),
  };
}

export function conversationListCapability(ctx: TenantContext): ConversationListCapability {
  return {
    create: can(ctx, 'conversation:reply'),
    readAll: can(ctx, 'conversation:read_all'),
  };
}

export function conversationDetailCapability(ctx: TenantContext): ConversationDetailCapability {
  const base = conversationCapability(ctx);
  return {
    ...base,
    sendTemplate: base.reply && can(ctx, 'template:read'),
  };
}
