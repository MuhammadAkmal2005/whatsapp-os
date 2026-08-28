/**
 * Conversation Context Loader & RAG Extension Point.
 *
 * Loads bounded conversation history, rolling summaries, and contact profile
 * for the Agent Runtime.
 *
 * Provides a clean extension point interface for future RAG / Knowledge retrieval.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import type { AIMessage } from '@/services/ai/ai-provider.interface';
import type { AITenantContext } from './context';

export interface AIConversationContext {
  conversationId: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string;
  summary: string | null;
  recentMessages: AIMessage[];
  aiEnabled: boolean;
}

/**
 * Extension point interface for future RAG knowledge retrieval.
 * NOTE: As per Unit 1 boundary, this is a pure contract with no vector queries.
 */
export interface AIRetrievalProvider {
  /**
   * Retrieves relevant knowledge chunk contents for a given user query.
   */
  retrieveContext(query: string, ctx: AITenantContext): Promise<string[]>;
}

export type LoadContextOptions = {
  maxRecentMessages?: number;
};

/**
 * Loads bounded conversation context for the AI runtime.
 */
export async function loadConversationContext(
  db: Db,
  workspaceId: string,
  conversationId: string,
  options: LoadContextOptions = {},
): Promise<AIConversationContext> {
  const maxMessages = options.maxRecentMessages ?? 15;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: {
      id: true,
      contactId: true,
      summary: true,
      aiEnabled: true,
      contact: {
        select: {
          id: true,
          name: true,
          phoneE164: true,
          waProfileName: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new NotFoundError('Conversation');
  }

  // Load recent messages (descending for limit, then reversed for chronological order)
  const messageRows = await db.message.findMany({
    where: { conversationId, workspaceId },
    take: maxMessages,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      direction: true,
      type: true,
      body: true,
      sentByAi: true,
      createdAt: true,
    },
  });

  messageRows.reverse();

  const recentMessages: AIMessage[] = messageRows
    .filter((m) => Boolean(m.body && m.body.trim()))
    .map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.body ?? '',
    }));

  return {
    conversationId: conversation.id,
    contactId: conversation.contact.id,
    contactName: conversation.contact.name ?? conversation.contact.waProfileName ?? null,
    contactPhone: conversation.contact.phoneE164,
    summary: conversation.summary,
    recentMessages,
    aiEnabled: conversation.aiEnabled,
  };
}
