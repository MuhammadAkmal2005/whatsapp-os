/**
 * Internal helpers for conversation and message services.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  findConversationById,
  type ConversationDetailRow,
} from '@/server/repositories/conversation.repository';
import type { TenantContext } from '@/server/tenancy/context';

export type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function assertTouched(count: number, what = 'Conversation'): void {
  if (count === 0) throw new NotFoundError(what);
}

export async function loadConversationInWorkspace(
  ctx: TenantContext,
  conversationId: string,
): Promise<ConversationDetailRow> {
  const row = await findConversationById(prisma, ctx.workspaceId, conversationId);
  if (!row) throw new NotFoundError('Conversation');
  return row;
}

export async function auditConversation(
  ctx: TenantContext,
  action: string,
  resourceType: 'Conversation' | 'Message',
  resourceId: string,
  metadata?: Record<string, unknown> | null,
  meta?: AuditMeta,
): Promise<void> {
  try {
    await appendAuditLog(prisma, {
      action,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      actorType: 'USER',
      resourceType,
      resourceId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata: metadata ?? null,
    });
  } catch {
    // Non-blocking for primary path
  }
}
