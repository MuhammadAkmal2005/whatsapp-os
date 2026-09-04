/**
 * Delivery of an agent's reply into the customer's conversation.
 *
 * The agent runtime deliberately stops at producing text: the playground and the
 * live inbox share one runtime, and only one of them should reach the customer.
 * This service is that live path — it writes the outbound message attributed to
 * the AI agent, then hands the wire transmission to the existing
 * `whatsapp.send_message` job rather than calling the provider itself.
 *
 * Enqueueing rather than dispatching inline buys two things. The send job already
 * carries eight attempts against a per-message-idempotent dispatcher, so a
 * transient Meta failure retries on its own; and a provider outage no longer
 * forces a re-run of the whole AI turn, which costs tokens and would trip the
 * turn's own uniqueness constraint anyway.
 *
 * This is a system-actor service. A webhook has no signed-in member behind it, so
 * it follows `whatsapp/inbound.service.ts`: scope taken from a `{ workspaceId }`,
 * repositories called directly, no `requirePermission`. That is not a gap in
 * authorization — there is no user whose permissions could be consulted. What the
 * AI is allowed to *do* is enforced in the tool registry, where the caller is the
 * agent and the permissions are the agent's.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { dedupeKey, queue } from '@/server/jobs';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  findConversationDeliveryState,
  touchConversationActivity,
} from '@/server/repositories/conversation.repository';
import { createMessage, findAIReplyForTurn } from '@/server/repositories/message.repository';

export type DeliverAgentReplyInput = {
  conversationId: string;
  /** The AI turn this reply belongs to. Stamped onto the message as the delivery
   *  idempotency key. */
  turnId: string;
  agentId: string;
  replyText: string;
};

export type DeliverAgentReplyResult =
  | { delivered: true; messageId: string; alreadyDelivered: boolean }
  | {
      delivered: false;
      reason: 'EMPTY_REPLY' | 'CONVERSATION_NOT_FOUND' | 'AI_DISABLED';
    };

/**
 * Writes and queues one AI reply.
 *
 * Safe to call more than once for the same turn: the second call finds the message
 * it already wrote and reports it instead of writing another.
 */
export async function deliverAgentReply(
  scope: { workspaceId: string },
  input: DeliverAgentReplyInput,
): Promise<DeliverAgentReplyResult> {
  const workspaceId = scope.workspaceId;
  const body = input.replyText.trim();

  if (!body) {
    return { delivered: false, reason: 'EMPTY_REPLY' };
  }

  const conversation = await findConversationDeliveryState(
    prisma,
    workspaceId,
    input.conversationId,
  );

  if (!conversation) {
    return { delivered: false, reason: 'CONVERSATION_NOT_FOUND' };
  }

  // The last of three human-takeover checks — the runtime checks before the turn
  // and again after it. This one closes the remaining window: an owner who hits
  // "take over" while the model is mid-sentence must not then watch the AI speak
  // over them.
  if (!conversation.aiEnabled) {
    logger.info('ai.reply.suppressed', {
      workspaceId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      reason: 'AI_DISABLED',
    });
    return { delivered: false, reason: 'AI_DISABLED' };
  }

  const existing = await findAIReplyForTurn(
    prisma,
    workspaceId,
    input.conversationId,
    input.turnId,
  );

  if (existing) {
    // A prior attempt wrote the row. Re-enqueue rather than return early: the
    // failure that brought us back here may have been the enqueue itself, and the
    // dedupe key makes a redundant enqueue free.
    await enqueueSend(workspaceId, existing.id);
    return { delivered: true, messageId: existing.id, alreadyDelivered: true };
  }

  const now = new Date();

  const message = await createMessage(prisma, workspaceId, {
    conversationId: input.conversationId,
    direction: 'OUTBOUND',
    type: 'TEXT',
    // QUEUED, not SENDING: the dispatcher owns the state machine from here, and
    // claiming a state it did not set would break its own idempotency checks.
    status: 'QUEUED',
    body,
    sentByAi: true,
    aiAgentId: input.agentId,
    payload: { aiTurnId: input.turnId },
    occurredAt: now,
    sentAt: null,
  });

  await touchConversationActivity(prisma, workspaceId, input.conversationId, {
    lastMessageAt: now,
    direction: 'OUTBOUND',
    firstResponse: conversation.firstResponseAt === null,
  });

  await enqueueSend(workspaceId, message.id);

  // Best-effort: the reply is already committed and queued, and losing the ledger
  // entry must not undo a customer-visible action or send it twice on retry.
  await appendAuditLog(prisma, {
    action: 'ai.reply.sent',
    workspaceId,
    actorType: 'AI_AGENT',
    resourceType: 'Message',
    resourceId: message.id,
    metadata: {
      conversationId: input.conversationId,
      agentId: input.agentId,
      turnId: input.turnId,
    },
  }).catch((error) => {
    logger.error('ai.reply.audit_failed', {
      workspaceId,
      messageId: message.id,
      error: String(error),
    });
  });

  logger.info('ai.reply.delivered', {
    workspaceId,
    conversationId: input.conversationId,
    messageId: message.id,
    turnId: input.turnId,
    agentId: input.agentId,
  });

  return { delivered: true, messageId: message.id, alreadyDelivered: false };
}

/** Keyed on the message id, so this is idempotent however many times it runs. */
async function enqueueSend(workspaceId: string, messageId: string): Promise<void> {
  await queue.enqueue(
    'whatsapp.send_message',
    { workspaceId, messageId },
    { dedupeKey: dedupeKey('whatsapp.send_message', messageId) },
  );
}
