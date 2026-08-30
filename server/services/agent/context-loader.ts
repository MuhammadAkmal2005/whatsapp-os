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
    recentMessages: enforceContextBudget(recentMessages),
    aiEnabled: conversation.aiEnabled,
  };
}

/**
 * Deterministic Context Budgeting
 * Enforces a maximum character limit (proxy for tokens) while preserving:
 * 1. The latest customer message (highest priority)
 * 2. Tool call & result pairing (never keep a tool call without its result)
 */
export function enforceContextBudget(
  messages: AIMessage[],
  maxChars = 12000,
): AIMessage[] {
  if (messages.length === 0) return [];

  const estimatedSize = (msg: AIMessage) => {
    let size = msg.content.length;
    if (msg.toolCalls) {
      size += JSON.stringify(msg.toolCalls).length;
    }
    if (msg.toolResult) {
      size += JSON.stringify(msg.toolResult).length;
    }
    return size;
  };

  const totalSize = messages.reduce((acc, msg) => acc + estimatedSize(msg), 0);
  if (totalSize <= maxChars) {
    return messages;
  }

  // Always keep the very last message if it's from the user
  const latestMessage = messages[messages.length - 1];
  const mustKeepLatest = latestMessage && latestMessage.role === 'user';
  
  let currentSize = 0;
  const keepIndices = new Set<number>();

  if (mustKeepLatest) {
    keepIndices.add(messages.length - 1);
    currentSize += estimatedSize(latestMessage);
  }

  // Work backwards, adding messages until we hit the budget
  // Note: we must add them in pairs if they are tool calls/results
  for (let i = messages.length - (mustKeepLatest ? 2 : 1); i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    
    // If it's a tool result, we must also keep the preceding tool call
    if (msg.role === 'tool' || msg.toolResult) {
      // Find the corresponding tool call (usually the immediately preceding assistant message)
      let toolCallIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j]?.toolCalls?.some(tc => tc.id === msg.toolResult?.toolCallId)) {
          toolCallIdx = j;
          break;
        }
      }

      if (toolCallIdx !== -1) {
        const toolCallMsg = messages[toolCallIdx];
        if (!toolCallMsg) continue;
        const combinedSize = estimatedSize(msg) + estimatedSize(toolCallMsg);
        if (currentSize + combinedSize <= maxChars) {
          keepIndices.add(i);
          keepIndices.add(toolCallIdx);
          currentSize += combinedSize;
          i = toolCallIdx; // Skip the tool call since we just processed it
        } else {
          // Can't fit the pair, so we stop here
          break;
        }
      }
    } else {
      // Normal message
      if (currentSize + estimatedSize(msg) <= maxChars) {
        keepIndices.add(i);
        currentSize += estimatedSize(msg);
      } else {
        break;
      }
    }
  }

  // Reconstruct the array in original order
  return messages.filter((_, idx) => keepIndices.has(idx));
}
