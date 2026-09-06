/**
 * Messages repository.
 *
 * Workspace-scoped database access for thread messages and attachments.
 * Enforces monotonic status transitions and handles attachment creation.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type {
  MessageDirection,
  MessageStatus,
  MessageType,
} from '@/server/validation/conversation';

export type MessageAttachmentRow = {
  id: string;
  workspaceId: string;
  messageId: string;
  kind: MessageType;
  storageKey: string | null;
  providerMediaId: string | null;
  mimeType: string;
  fileName: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  transcript: string | null;
  downloadedAt: Date | null;
  createdAt: Date;
};

export type MessageRow = {
  id: string;
  workspaceId: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  body: string | null;
  providerMessageId: string | null;
  replyToProviderMessageId: string | null;
  senderMemberId: string | null;
  senderContactId: string | null;
  sentByAi: boolean;
  aiAgentId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  payload: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  occurredAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  /**
   * Set when a send failed in a way that does not tell us whether Meta received it.
   *
   * A read timeout is not a delivery failure. The request may have been accepted and the
   * response lost, so the message is neither SENT (we have no id to prove it) nor FAILED
   * (claiming that invites a retry that double-sends to a real customer). This column is
   * what lets the inbox say "we do not know" instead of guessing.
   */
  deliveryUncertainAt: Date | null;
};

export type MessageWithDetailsRow = MessageRow & {
  attachments: MessageAttachmentRow[];
  senderMember: {
    id: string;
    role: string;
    user: { id: string; name: string; email: string; avatarUrl: string | null };
  } | null;
  senderContact: {
    id: string;
    name: string | null;
    phoneE164: string;
  } | null;
};

export type CreateAttachmentFields = {
  kind: MessageType;
  storageKey?: string | null;
  providerMediaId?: string | null;
  mimeType: string;
  fileName?: string | null;
  byteSize?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  caption?: string | null;
  transcript?: string | null;
};

export type CreateMessageFields = {
  conversationId: string;
  direction: MessageDirection;
  type?: MessageType;
  status?: MessageStatus;
  body?: string | null;
  providerMessageId?: string | null;
  replyToProviderMessageId?: string | null;
  senderMemberId?: string | null;
  senderContactId?: string | null;
  sentByAi?: boolean;
  aiAgentId?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  failedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  attachments?: CreateAttachmentFields[];
};

export type ListMessagesFilters = {
  direction?: MessageDirection;
  cursor?: string;
  limit: number;
};

export type MessagePage = {
  rows: MessageWithDetailsRow[];
  nextCursor: string | null;
};

const MESSAGE_SELECT = {
  id: true,
  workspaceId: true,
  conversationId: true,
  direction: true,
  type: true,
  status: true,
  body: true,
  providerMessageId: true,
  replyToProviderMessageId: true,
  senderMemberId: true,
  senderContactId: true,
  sentByAi: true,
  aiAgentId: true,
  templateName: true,
  templateLanguage: true,
  payload: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  occurredAt: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  failedAt: true,
  deliveryUncertainAt: true,
  attachments: true,
  senderMember: {
    select: {
      id: true,
      role: true,
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  },
  senderContact: {
    select: {
      id: true,
      name: true,
      phoneE164: true,
    },
  },
} as const;

export async function createMessage(
  db: Db,
  workspaceId: string,
  fields: CreateMessageFields,
): Promise<MessageWithDetailsRow> {
  const defaultStatus: MessageStatus =
    fields.status ?? (fields.direction === 'INBOUND' ? 'RECEIVED' : 'QUEUED');

  const message = await db.message.create({
    data: {
      workspaceId,
      conversationId: fields.conversationId,
      direction: fields.direction,
      type: fields.type ?? 'TEXT',
      status: defaultStatus,
      body: fields.body ?? null,
      providerMessageId: fields.providerMessageId ?? null,
      replyToProviderMessageId: fields.replyToProviderMessageId ?? null,
      senderMemberId: fields.senderMemberId ?? null,
      senderContactId: fields.senderContactId ?? null,
      sentByAi: fields.sentByAi ?? false,
      aiAgentId: fields.aiAgentId ?? null,
      templateName: fields.templateName ?? null,
      templateLanguage: fields.templateLanguage ?? null,
      payload: (fields.payload ?? undefined) as never,
      occurredAt: fields.occurredAt ?? new Date(),
      sentAt: fields.sentAt ?? (fields.direction === 'OUTBOUND' ? new Date() : null),
      deliveredAt: fields.deliveredAt ?? null,
      readAt: fields.readAt ?? null,
      failedAt: fields.failedAt ?? null,
      errorCode: fields.errorCode ?? null,
      errorMessage: fields.errorMessage ?? null,
      attachments: fields.attachments && fields.attachments.length > 0
        ? {
            create: fields.attachments.map((att) => ({
              workspaceId,
              kind: att.kind,
              storageKey: att.storageKey ?? null,
              providerMediaId: att.providerMediaId ?? null,
              mimeType: att.mimeType,
              fileName: att.fileName ?? null,
              byteSize: att.byteSize ?? null,
              width: att.width ?? null,
              height: att.height ?? null,
              durationMs: att.durationMs ?? null,
              caption: att.caption ?? null,
              transcript: att.transcript ?? null,
            })),
          }
        : undefined,
    },
    select: MESSAGE_SELECT,
  });

  return message as MessageWithDetailsRow;
}

export async function findMessageById(
  db: Db,
  workspaceId: string,
  messageId: string,
): Promise<MessageWithDetailsRow | null> {
  const row = await db.message.findFirst({
    where: { id: messageId, workspaceId },
    select: MESSAGE_SELECT,
  });
  return (row as MessageWithDetailsRow) ?? null;
}

export async function findMessageByProviderId(
  db: Db,
  workspaceId: string,
  providerMessageId: string,
): Promise<MessageWithDetailsRow | null> {
  const row = await db.message.findFirst({
    where: { providerMessageId, workspaceId },
    select: MESSAGE_SELECT,
  });
  return (row as MessageWithDetailsRow) ?? null;
}

/**
 * The outbound reply already written for a given AI turn, if there is one.
 *
 * The turn id is stamped into `Message.payload` at delivery time precisely so this
 * lookup exists. Without it, a job retry after the reply row was written but
 * before it was queued for sending would write a second reply, and the customer
 * would receive the same answer twice — the one failure mode that is visible to
 * them and impossible to explain.
 *
 * Filtered on the JSON path rather than a dedicated column: the scope is already
 * narrowed to one conversation's outbound messages, so the scan is tiny, and the
 * alternative is a migration for a field only this path reads.
 */
export async function findAIReplyForTurn(
  db: Db,
  workspaceId: string,
  conversationId: string,
  aiTurnId: string,
): Promise<{ id: string } | null> {
  return db.message.findFirst({
    where: {
      workspaceId,
      conversationId,
      direction: 'OUTBOUND',
      sentByAi: true,
      payload: { path: ['aiTurnId'], equals: aiTurnId },
    },
    select: { id: true },
  });
}

export async function listMessages(
  db: Db,
  workspaceId: string,
  conversationId: string,
  filters: ListMessagesFilters,
): Promise<MessagePage> {
  const where: Record<string, unknown> = {
    workspaceId,
    conversationId,
  };

  if (filters.direction) where.direction = filters.direction;

  const rows = await db.message.findMany({
    where,
    take: filters.limit + 1,
    ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: MESSAGE_SELECT,
  });

  let nextCursor: string | null = null;
  if (rows.length > filters.limit) {
    const next = rows.pop();
    nextCursor = next ? next.id : null;
  }

  return {
    rows: rows as MessageWithDetailsRow[],
    nextCursor,
  };
}

/** Rank monotonic progression for status advancement */
const STATUS_RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  RECEIVED: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

export async function updateMessageStatus(
  db: Db,
  workspaceId: string,
  messageId: string,
  newStatus: MessageStatus,
  options: {
    occurredAt?: Date;
    errorCode?: string | null;
    errorMessage?: string | null;
  } = {},
): Promise<number> {
  const existing = await db.message.findFirst({
    where: { id: messageId, workspaceId },
    select: { id: true, status: true },
  });

  if (!existing) return 0;

  // Don't regress from READ to DELIVERED/SENT (monotonic transition)
  if (STATUS_RANK[existing.status] >= STATUS_RANK[newStatus] && newStatus !== 'FAILED') {
    return 0; // already at equal or advanced state, 0 rows modified
  }

  const timestamp = options.occurredAt ?? new Date();
  const updateData: Record<string, unknown> = { status: newStatus };

  if (newStatus === 'SENT') updateData.sentAt = timestamp;
  else if (newStatus === 'DELIVERED') updateData.deliveredAt = timestamp;
  else if (newStatus === 'READ') updateData.readAt = timestamp;
  else if (newStatus === 'FAILED') {
    updateData.failedAt = timestamp;
    if (options.errorCode) updateData.errorCode = options.errorCode;
    if (options.errorMessage) updateData.errorMessage = options.errorMessage;
  }

  const result = await db.message.updateMany({
    where: { id: messageId, workspaceId },
    data: updateData,
  });

  return result.count;
}

export async function recordMessageDispatch(
  db: Db,
  workspaceId: string,
  messageId: string,
  dispatch: {
    providerMessageId: string;
    status?: MessageStatus;
    sentAt?: Date;
  },
): Promise<MessageWithDetailsRow | null> {
  const sentAt = dispatch.sentAt ?? new Date();
  const status = dispatch.status ?? 'SENT';

  await db.message.updateMany({
    where: { id: messageId, workspaceId },
    data: {
      providerMessageId: dispatch.providerMessageId,
      status,
      sentAt,
      // Meta answered with an id, so whatever we were unsure about before is now settled.
      deliveryUncertainAt: null,
    },
  });

  return findMessageById(db, workspaceId, messageId);
}

/**
 * Records that a send's outcome is unknown, without claiming success or failure.
 *
 * The status is left where it is — SENDING — on purpose. Advancing it to SENT would put a
 * message in the customer's thread that may never have been delivered; advancing it to
 * FAILED would invite the retry that sends a second copy of a message Meta may already
 * have accepted. The row keeps the transport's own words in `errorMessage` so an operator
 * can see why we are unsure.
 */
export async function markDeliveryUncertain(
  db: Db,
  workspaceId: string,
  messageId: string,
  detail: { errorCode: string; errorMessage: string; at?: Date },
): Promise<void> {
  await db.message.updateMany({
    where: { id: messageId, workspaceId },
    data: {
      deliveryUncertainAt: detail.at ?? new Date(),
      errorCode: detail.errorCode,
      errorMessage: detail.errorMessage,
    },
  });
}
