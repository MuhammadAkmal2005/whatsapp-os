/**
 * Conversations repository.
 *
 * Scopes every database operation to `workspaceId` to ensure strict tenant isolation.
 * Contains read and write operations for conversations and their participants.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type {
  Channel,
  ConversationStatus,
  HandoffReason,
  Priority,
} from '@/server/validation/conversation';

export type ConversationRow = {
  id: string;
  workspaceId: string;
  channel: Channel;
  contactId: string;
  phoneNumberId: string | null;
  status: ConversationStatus;
  priority: Priority;
  assignedToMemberId: string | null;
  aiEnabled: boolean;
  aiPausedAt: Date | null;
  aiPausedByMemberId: string | null;
  handoffReason: HandoffReason | null;
  handoffAt: Date | null;
  summary: string | null;
  summarisedThroughMessageId: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  unreadCount: number;
  messageCount: number;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationParticipantRow = {
  id: string;
  conversationId: string;
  memberId: string | null;
  contactId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
};

export type ConversationListRow = ConversationRow & {
  contact: {
    id: string;
    name: string | null;
    phoneE164: string;
    waProfileName: string | null;
  };
  assignedTo: {
    id: string;
    role: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
    };
  } | null;
};

export type ConversationDetailRow = ConversationListRow & {
  participants: (ConversationParticipantRow & {
    member: {
      id: string;
      role: string;
      user: { id: string; name: string; email: string; avatarUrl: string | null };
    } | null;
    contact: { id: string; name: string | null; phoneE164: string } | null;
  })[];
};

export type ConversationFilters = {
  status?: ConversationStatus;
  priority?: Priority;
  assignedToMemberId?: string | null;
  unassignedOnly?: boolean;
  assignedToUserId?: string; // used when AGENT role is scoped to their user
  contactId?: string;
  search?: string | null;
  channel?: Channel;
  cursor?: string;
  limit: number;
};

export type ConversationPage = {
  rows: ConversationListRow[];
  nextCursor: string | null;
};

const CONVERSATION_SELECT = {
  id: true,
  workspaceId: true,
  channel: true,
  contactId: true,
  phoneNumberId: true,
  status: true,
  priority: true,
  assignedToMemberId: true,
  aiEnabled: true,
  aiPausedAt: true,
  aiPausedByMemberId: true,
  handoffReason: true,
  handoffAt: true,
  summary: true,
  summarisedThroughMessageId: true,
  lastMessageAt: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  unreadCount: true,
  messageCount: true,
  firstResponseAt: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CreateConversationFields = {
  contactId: string;
  channel?: Channel;
  phoneNumberId?: string | null;
  status?: ConversationStatus;
  priority?: Priority;
  assignedToMemberId?: string | null;
  aiEnabled?: boolean;
};

export type UpdateConversationFields = Partial<{
  status: ConversationStatus;
  priority: Priority;
  assignedToMemberId: string | null;
  aiEnabled: boolean;
  aiPausedAt: Date | null;
  aiPausedByMemberId: string | null;
  handoffReason: HandoffReason | null;
  handoffAt: Date | null;
  summary: string | null;
  summarisedThroughMessageId: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}>;

export async function createConversation(
  db: Db,
  workspaceId: string,
  fields: CreateConversationFields,
): Promise<ConversationRow> {
  const participants = [
    { contactId: fields.contactId },
    ...(fields.assignedToMemberId ? [{ memberId: fields.assignedToMemberId }] : []),
  ];

  const conversation = await db.conversation.create({
    data: {
      workspaceId,
      channel: fields.channel ?? 'WHATSAPP',
      contactId: fields.contactId,
      phoneNumberId: fields.phoneNumberId ?? null,
      status: fields.status ?? 'OPEN',
      priority: fields.priority ?? 'NORMAL',
      assignedToMemberId: fields.assignedToMemberId ?? null,
      aiEnabled: fields.aiEnabled ?? true,
      participants: {
        create: participants,
      },
    },
    select: CONVERSATION_SELECT,
  });

  return conversation;
}

export async function findConversationById(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationDetailRow | null> {
  return db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: {
      ...CONVERSATION_SELECT,
      contact: {
        select: {
          id: true,
          name: true,
          phoneE164: true,
          waProfileName: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          role: true,
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      },
      participants: {
        select: {
          id: true,
          conversationId: true,
          memberId: true,
          contactId: true,
          joinedAt: true,
          leftAt: true,
          member: {
            select: {
              id: true,
              role: true,
              user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            },
          },
          contact: {
            select: { id: true, name: true, phoneE164: true },
          },
        },
      },
    },
  });
}

export async function findActiveConversationForContact(
  db: Db,
  workspaceId: string,
  contactId: string,
  channel: Channel = 'WHATSAPP',
): Promise<ConversationRow | null> {
  return db.conversation.findFirst({
    where: {
      workspaceId,
      contactId,
      channel,
      status: { in: ['OPEN', 'PENDING'] },
    },
    orderBy: { createdAt: 'desc' },
    select: CONVERSATION_SELECT,
  });
}

export async function findLatestConversationForContact(
  db: Db,
  workspaceId: string,
  contactId: string,
  channel: Channel = 'WHATSAPP',
): Promise<ConversationRow | null> {
  return db.conversation.findFirst({
    where: {
      workspaceId,
      contactId,
      channel,
    },
    orderBy: { createdAt: 'desc' },
    select: CONVERSATION_SELECT,
  });
}

function buildConversationWhere(workspaceId: string, filters: ConversationFilters) {
  const where: Record<string, unknown> = { workspaceId };

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.channel) where.channel = filters.channel;
  if (filters.contactId) where.contactId = filters.contactId;

  if (filters.unassignedOnly) {
    where.assignedToMemberId = null;
  } else if (filters.assignedToMemberId) {
    where.assignedToMemberId = filters.assignedToMemberId;
  } else if (filters.assignedToUserId) {
    where.assignedTo = { userId: filters.assignedToUserId };
  }

  if (filters.search) {
    const s = filters.search;
    where.OR = [
      { contact: { name: { contains: s, mode: 'insensitive' } } },
      { contact: { phoneE164: { contains: s } } },
      { summary: { contains: s, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function listConversations(
  db: Db,
  workspaceId: string,
  filters: ConversationFilters,
): Promise<ConversationPage> {
  const where = buildConversationWhere(workspaceId, filters);

  const rows = await db.conversation.findMany({
    where,
    take: filters.limit + 1,
    ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: {
      ...CONVERSATION_SELECT,
      contact: {
        select: {
          id: true,
          name: true,
          phoneE164: true,
          waProfileName: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          role: true,
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      },
    },
  });

  let nextCursor: string | null = null;
  if (rows.length > filters.limit) {
    const next = rows.pop();
    nextCursor = next ? next.id : null;
  }

  return { rows, nextCursor };
}

export async function countConversations(db: Db, workspaceId: string): Promise<number> {
  return db.conversation.count({ where: { workspaceId } });
}

export async function countConversationsByStatus(
  db: Db,
  workspaceId: string,
): Promise<Record<ConversationStatus, number>> {
  const counts = await db.conversation.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { _all: true },
  });

  const result: Record<ConversationStatus, number> = {
    OPEN: 0,
    PENDING: 0,
    RESOLVED: 0,
    CLOSED: 0,
  };

  for (const entry of counts) {
    result[entry.status] = entry._count._all;
  }

  return result;
}

export async function updateConversation(
  db: Db,
  workspaceId: string,
  conversationId: string,
  fields: UpdateConversationFields,
): Promise<number> {
  const result = await db.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: fields,
  });
  return result.count;
}

export async function assignConversation(
  db: Db,
  workspaceId: string,
  conversationId: string,
  memberId: string | null,
): Promise<number> {
  const result = await db.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: { assignedToMemberId: memberId },
  });

  if (result.count > 0 && memberId) {
    // Ensure participant row exists for the newly assigned member
    await db.conversationParticipant.upsert({
      where: {
        conversationId_memberId: { conversationId, memberId },
      },
      update: { leftAt: null },
      create: {
        conversationId,
        memberId,
      },
    });
  }

  return result.count;
}

export async function touchConversationActivity(
  db: Db,
  workspaceId: string,
  conversationId: string,
  deltas: {
    lastMessageAt: Date;
    direction: 'INBOUND' | 'OUTBOUND';
    unreadDelta?: number;
    firstResponse?: boolean;
    incrementCount?: boolean;
  },
): Promise<void> {
  const updateData: Record<string, unknown> = {
    lastMessageAt: deltas.lastMessageAt,
  };

  if (deltas.incrementCount !== false) {
    updateData.messageCount = { increment: 1 };
  }

  if (deltas.direction === 'INBOUND') {
    updateData.lastInboundAt = deltas.lastMessageAt;
    updateData.unreadCount = { increment: deltas.unreadDelta ?? 1 };
  } else {
    updateData.lastOutboundAt = deltas.lastMessageAt;
    if (deltas.firstResponse) {
      updateData.firstResponseAt = deltas.lastMessageAt;
    }
  }

  await db.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: updateData,
  });
}

export async function clearUnreadCount(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: { unreadCount: 0 },
  });
}

export async function deleteConversation(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<number> {
  const result = await db.conversation.deleteMany({
    where: { id: conversationId, workspaceId },
  });
  return result.count;
}
