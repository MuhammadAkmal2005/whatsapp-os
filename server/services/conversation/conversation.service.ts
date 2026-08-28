/**
 * Conversation service.
 *
 * Core business logic for customer conversations. Handles authorization, tenant scoping,
 * assignment, status transitions, and AI toggle controls.
 */

import { DEFAULT_PAGE_SIZE } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { findContactById } from '@/server/repositories/contact.repository';
import {
  assignConversation as assignConversationRow,
  countConversations,
  countConversationsByStatus,
  createConversation as createConversationRow,
  deleteConversation as deleteConversationRow,
  findActiveConversationForContact,
  listConversations as listConversationsRows,
  updateConversation as updateConversationRow,
  type ConversationDetailRow,
  type ConversationListRow,
} from '@/server/repositories/conversation.repository';
import { createMessage as createMessageRow } from '@/server/repositories/message.repository';
import { findMemberById } from '@/server/repositories/member.repository';
import {
  conversationCapability,
  conversationDetailCapability,
  conversationListCapability,
  type ConversationCapability,
  type ConversationDetailCapability,
  type ConversationListCapability,
} from '@/server/services/conversation/conversation.capability';
import {
  assertTouched,
  auditConversation,
  loadConversationInWorkspace,
  type AuditMeta,
} from '@/server/services/conversation/conversation.internal';
import {
  conversationScope,
  requirePermission,
  type TenantContext,
} from '@/server/tenancy/context';
import type {
  AssignConversationInput,
  CreateConversationInput,
  DeleteConversationInput,
  ListConversationsInput,
  ToggleConversationAiInput,
  UpdateConversationPriorityInput,
  UpdateConversationStatusInput,
} from '@/server/validation/conversation';

export type ConversationSummary = ConversationListRow & {
  can: ConversationCapability;
};

export type ConversationDetail = ConversationDetailRow & {
  can: ConversationDetailCapability;
};

export type ConversationListPage = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
  statusCounts: Record<string, number>;
  total: number;
  can: ConversationListCapability;
};

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:read');

  const row = await loadConversationInWorkspace(ctx, conversationId);

  // Scoping check for AGENT role without global read permission
  const scope = conversationScope(ctx);
  if (scope.kind === 'assigned') {
    const isAssigned =
      row.assignedToMemberId === ctx.membershipId ||
      row.assignedTo?.user.id === ctx.user.id ||
      row.participants.some((p) => p.memberId === ctx.membershipId);

    if (!isAssigned) {
      throw new NotFoundError('Conversation');
    }
  }

  return {
    ...row,
    can: conversationDetailCapability(ctx),
  };
}

export async function listConversations(
  ctx: TenantContext,
  input: ListConversationsInput,
): Promise<ConversationListPage> {
  requirePermission(ctx, 'conversation:read');

  const scope = conversationScope(ctx);

  const filters = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.contactId ? { contactId: input.contactId } : {}),
    ...(input.search ? { search: input.search } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: input.limit ?? DEFAULT_PAGE_SIZE,
    ...(input.assignedToMemberId === 'unassigned'
      ? { unassignedOnly: true }
      : input.assignedToMemberId
        ? { assignedToMemberId: input.assignedToMemberId }
        : scope.kind === 'assigned'
          ? { assignedToUserId: scope.userId }
          : {}),
  };

  const [page, statusCounts, total] = await Promise.all([
    listConversationsRows(prisma, ctx.workspaceId, filters),
    countConversationsByStatus(prisma, ctx.workspaceId),
    countConversations(prisma, ctx.workspaceId),
  ]);

  const can = conversationCapability(ctx);

  return {
    conversations: page.rows.map((row) => ({ ...row, can })),
    nextCursor: page.nextCursor,
    statusCounts,
    total,
    can: conversationListCapability(ctx),
  };
}

export async function getActiveConversationForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<ConversationDetail | null> {
  requirePermission(ctx, 'conversation:read');

  const active = await findActiveConversationForContact(prisma, ctx.workspaceId, contactId);
  if (!active) return null;

  return getConversation(ctx, active.id);
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function createConversation(
  ctx: TenantContext,
  input: CreateConversationInput,
  meta?: AuditMeta,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:reply');

  // Verify contact exists in this workspace
  const contact = await findContactById(prisma, ctx.workspaceId, input.contactId);
  if (!contact) throw new NotFoundError('Contact');

  // Verify assignee if provided
  if (input.assignedToMemberId) {
    const member = await findMemberById(prisma, ctx.workspaceId, input.assignedToMemberId);
    if (!member) throw new NotFoundError('Member');
  }

  const created = await createConversationRow(prisma, ctx.workspaceId, {
    channel: input.channel,
    contactId: input.contactId,
    phoneNumberId: input.phoneNumberId,
    status: input.status,
    priority: input.priority,
    assignedToMemberId: input.assignedToMemberId,
    aiEnabled: true,
  });

  // Append initial message if given
  if (input.initialMessage) {
    await createMessageRow(prisma, ctx.workspaceId, {
      conversationId: created.id,
      direction: 'OUTBOUND',
      type: input.initialMessage.type,
      body: input.initialMessage.body,
      senderMemberId: ctx.membershipId,
      status: 'SENT',
    });
  }

  await auditConversation(
    ctx,
    'conversation.created',
    'Conversation',
    created.id,
    {
      contactId: input.contactId,
      channel: input.channel,
      status: input.status,
    },
    meta,
  );

  return getConversation(ctx, created.id);
}

export async function updateConversationStatus(
  ctx: TenantContext,
  input: UpdateConversationStatusInput,
  meta?: AuditMeta,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:update_status');

  const existing = await loadConversationInWorkspace(ctx, input.conversationId);

  const resolvedAt = input.status === 'RESOLVED' ? new Date() : null;
  const closedAt = input.status === 'CLOSED' ? new Date() : null;

  const count = await updateConversationRow(prisma, ctx.workspaceId, input.conversationId, {
    status: input.status,
    resolvedAt: resolvedAt ?? (input.status === 'OPEN' ? null : existing.resolvedAt),
    closedAt: closedAt ?? (input.status === 'OPEN' ? null : existing.closedAt),
  });
  assertTouched(count, 'Conversation');

  await auditConversation(
    ctx,
    'conversation.status_changed',
    'Conversation',
    input.conversationId,
    {
      fromStatus: existing.status,
      toStatus: input.status,
    },
    meta,
  );

  return getConversation(ctx, input.conversationId);
}

export async function assignConversation(
  ctx: TenantContext,
  input: AssignConversationInput,
  meta?: AuditMeta,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:assign');

  await loadConversationInWorkspace(ctx, input.conversationId);

  if (input.assignedToMemberId) {
    const member = await findMemberById(prisma, ctx.workspaceId, input.assignedToMemberId);
    if (!member) throw new NotFoundError('Member');
  }

  const count = await assignConversationRow(
    prisma,
    ctx.workspaceId,
    input.conversationId,
    input.assignedToMemberId ?? null,
  );
  assertTouched(count, 'Conversation');

  await auditConversation(
    ctx,
    'conversation.assigned',
    'Conversation',
    input.conversationId,
    { assignedToMemberId: input.assignedToMemberId },
    meta,
  );

  return getConversation(ctx, input.conversationId);
}

export async function updateConversationPriority(
  ctx: TenantContext,
  input: UpdateConversationPriorityInput,
  meta?: AuditMeta,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:update_status');

  const existing = await loadConversationInWorkspace(ctx, input.conversationId);

  const count = await updateConversationRow(prisma, ctx.workspaceId, input.conversationId, {
    priority: input.priority,
  });
  assertTouched(count, 'Conversation');

  await auditConversation(
    ctx,
    'conversation.priority_changed',
    'Conversation',
    input.conversationId,
    { fromPriority: existing.priority, toPriority: input.priority },
    meta,
  );

  return getConversation(ctx, input.conversationId);
}

export async function toggleConversationAi(
  ctx: TenantContext,
  input: ToggleConversationAiInput,
  meta?: AuditMeta,
): Promise<ConversationDetail> {
  requirePermission(ctx, 'conversation:toggle_ai');

  await loadConversationInWorkspace(ctx, input.conversationId);

  const count = await updateConversationRow(prisma, ctx.workspaceId, input.conversationId, {
    aiEnabled: input.aiEnabled,
    aiPausedAt: input.aiEnabled ? null : new Date(),
    aiPausedByMemberId: input.aiEnabled ? null : ctx.membershipId,
    handoffReason: input.aiEnabled ? null : input.handoffReason ?? 'MANUAL_TAKEOVER',
    handoffAt: input.aiEnabled ? null : new Date(),
  });
  assertTouched(count, 'Conversation');

  await auditConversation(
    ctx,
    'conversation.ai_toggled',
    'Conversation',
    input.conversationId,
    { aiEnabled: input.aiEnabled, handoffReason: input.handoffReason },
    meta,
  );

  return getConversation(ctx, input.conversationId);
}

export async function deleteConversation(
  ctx: TenantContext,
  input: DeleteConversationInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'conversation:delete');

  await loadConversationInWorkspace(ctx, input.conversationId);

  const count = await deleteConversationRow(prisma, ctx.workspaceId, input.conversationId);
  assertTouched(count, 'Conversation');

  await auditConversation(
    ctx,
    'conversation.deleted',
    'Conversation',
    input.conversationId,
    null,
    meta,
  );
}
