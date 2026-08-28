/**
 * Message service.
 *
 * Core business logic for reading, creating and managing message states in a conversation.
 * Handles thread pagination, sender bindings, attachment linking, and activity metric touches.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import {
  clearUnreadCount,
  touchConversationActivity,
} from '@/server/repositories/conversation.repository';
import {
  createMessage as createMessageRow,
  findMessageById,
  listMessages as listMessagesRows,
  updateMessageStatus as updateMessageStatusRow,
  type MessagePage,
  type MessageWithDetailsRow,
} from '@/server/repositories/message.repository';
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
  ListMessagesInput,
  SendMessageInput,
  UpdateMessageStatusInput,
} from '@/server/validation/conversation';

export type MessageView = MessageWithDetailsRow;

export async function listMessages(
  ctx: TenantContext,
  input: ListMessagesInput,
  options: { markAsRead?: boolean } = { markAsRead: true },
): Promise<MessagePage> {
  requirePermission(ctx, 'conversation:read');

  const conversation = await loadConversationInWorkspace(ctx, input.conversationId);

  // Scoping check for AGENT role without global read permission
  const scope = conversationScope(ctx);
  if (scope.kind === 'assigned') {
    const isAssigned =
      conversation.assignedToMemberId === ctx.membershipId ||
      conversation.assignedTo?.user.id === ctx.user.id ||
      conversation.participants.some((p) => p.memberId === ctx.membershipId);

    if (!isAssigned) {
      throw new NotFoundError('Conversation');
    }
  }

  const page = await listMessagesRows(prisma, ctx.workspaceId, input.conversationId, {
    cursor: input.cursor,
    limit: input.limit ?? 50,
    direction: input.direction,
  });

  // Mark conversation as read when fetched by agent/member
  if (options.markAsRead && conversation.unreadCount > 0) {
    await clearUnreadCount(prisma, ctx.workspaceId, input.conversationId);
  }

  return page;
}

export async function getMessage(
  ctx: TenantContext,
  messageId: string,
): Promise<MessageView> {
  requirePermission(ctx, 'conversation:read');

  const message = await findMessageById(prisma, ctx.workspaceId, messageId);
  if (!message) throw new NotFoundError('Message');

  return message;
}

export async function sendMessage(
  ctx: TenantContext,
  input: SendMessageInput,
  meta?: AuditMeta,
): Promise<MessageView> {
  requirePermission(ctx, 'conversation:reply');

  const conversation = await loadConversationInWorkspace(ctx, input.conversationId);
  const direction = input.direction ?? 'OUTBOUND';

  const senderMemberId =
    direction === 'OUTBOUND'
      ? input.senderMemberId ?? ctx.membershipId
      : null;

  const senderContactId =
    direction === 'INBOUND'
      ? input.senderContactId ?? conversation.contactId
      : null;

  const occurredAt = input.occurredAt ?? new Date();

  const created = await createMessageRow(prisma, ctx.workspaceId, {
    conversationId: input.conversationId,
    direction,
    type: input.type ?? 'TEXT',
    status: input.status,
    body: input.body,
    providerMessageId: input.providerMessageId,
    replyToProviderMessageId: input.replyToProviderMessageId,
    senderMemberId,
    senderContactId,
    sentByAi: input.sentByAi ?? false,
    aiAgentId: input.aiAgentId,
    templateName: input.templateName,
    templateLanguage: input.templateLanguage,
    payload: input.payload,
    occurredAt,
    attachments: input.attachments,
  });

  // Update conversation activity indicators
  await touchConversationActivity(prisma, ctx.workspaceId, input.conversationId, {
    lastMessageAt: occurredAt,
    direction,
    firstResponse: conversation.firstResponseAt === null && direction === 'OUTBOUND',
  });

  await auditConversation(
    ctx,
    'message.sent',
    'Message',
    created.id,
    {
      conversationId: input.conversationId,
      direction: input.direction,
      type: input.type,
    },
    meta,
  );

  return created;
}

export async function updateMessageStatus(
  ctx: TenantContext,
  input: UpdateMessageStatusInput,
): Promise<MessageView> {
  requirePermission(ctx, 'conversation:reply');

  await getMessage(ctx, input.messageId);

  await updateMessageStatusRow(
    prisma,
    ctx.workspaceId,
    input.messageId,
    input.status,
    {
      occurredAt: input.occurredAt,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    },
  );

  return getMessage(ctx, input.messageId);
}
