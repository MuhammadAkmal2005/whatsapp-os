/**
 * Outbound WhatsApp Message Dispatch Service.
 *
 * Takes a message row that already exists and hands it to the provider. It never
 * creates a message, so a retry can never create a second thread entry — but a retry
 * can still cause a second *send*, and stopping that is most of what this file does.
 *
 * Four gates protect against it, in the order a retry would hit them: a provider id
 * already recorded, a status that has already advanced past sending, a re-read for the
 * concurrent case, and — the one that matters after a timeout — a recorded uncertainty.
 * A message we could not confirm is never sent again automatically, because Meta's
 * `/messages` endpoint has no idempotency key and would happily accept the duplicate.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { NotFoundError, RateLimitError } from '@/server/errors';
import { consume } from '@/server/ratelimit/limiter';
import {
  findConversationById,
  touchConversationActivity,
} from '@/server/repositories/conversation.repository';
import {
  findMessageById,
  updateMessageStatus,
  type MessageWithDetailsRow,
} from '@/server/repositories/message.repository';
import type { TenantContext } from '@/server/tenancy/context';
import {
  persistDispatchResult,
  recordSendFailure,
  recordSendSuccess,
} from './dispatch-outcome';
import { getWhatsAppProvider } from './provider.factory';
import type { ProviderSendResult } from './provider.interface';
import { classifySendFailure } from './send-failure';

export type DispatchOutboundOptions = {
  /** Optional provider overrides (e.g. for testing real Meta provider with mock fetch) */
  providerOptions?: {
    forceMeta?: boolean;
    fetchFn?: typeof fetch;
  };
};

/**
 * Dispatches an already-created outbound message to the WhatsApp provider.
 *
 * Scopes operation strictly to `ctx.workspaceId` and ensures idempotent dispatch.
 */
export async function dispatchOutboundMessage(
  ctxOrScope: TenantContext | { workspaceId: string },
  messageId: string,
  options?: DispatchOutboundOptions,
): Promise<MessageWithDetailsRow> {
  const workspaceId = ctxOrScope.workspaceId;

  const message = await findMessageById(prisma, workspaceId, messageId);
  if (!message) {
    throw new NotFoundError('Message');
  }

  // Idempotency check 1: If already has providerMessageId, return existing record immediately
  if (message.providerMessageId) {
    return message;
  }

  // Idempotency check 2: If already marked SENT, DELIVERED, or READ, return existing record
  if (
    message.status === 'SENT' ||
    message.status === 'DELIVERED' ||
    message.status === 'READ'
  ) {
    return message;
  }

  // Idempotency check 3: If message is in SENDING state, re-fetch to ensure providerMessageId was not written concurrently
  if (message.status === 'SENDING') {
    const refreshed = await findMessageById(prisma, workspaceId, messageId);
    if (
      refreshed?.providerMessageId ||
      (refreshed &&
        (refreshed.status === 'SENT' ||
          refreshed.status === 'DELIVERED' ||
          refreshed.status === 'READ'))
    ) {
      return refreshed;
    }
  }

  // Idempotency check 4: a previous attempt ended without an answer from Meta. Sending
  // again is the one action guaranteed to be wrong if that attempt did arrive, and the
  // customer is the person who pays for the mistake. A human can resend from the inbox
  // once they have looked at the thread; an automated retry cannot look.
  if (message.deliveryUncertainAt) {
    logger.warn('whatsapp.outbound.skipped_uncertain', {
      workspaceId,
      messageId: message.id,
      uncertainSince: message.deliveryUncertainAt.toISOString(),
    });
    return message;
  }

  const conversation = await findConversationById(prisma, workspaceId, message.conversationId);
  if (!conversation) {
    throw new NotFoundError('Conversation');
  }

  // A per-workspace ceiling on the transport itself, not on composing. Every send —
  // human, AI, automation, campaign — funnels through here, so this is the only place a
  // single busy tenant can be stopped from monopolising the worker pool. It defers
  // rather than drops: the message stays QUEUED and the job's backoff brings it back.
  const dispatchAllowance = await consume('messageDispatch', `workspace:${workspaceId}`);
  if (!dispatchAllowance.allowed) {
    logger.warn('whatsapp.outbound.dispatch_rate_limited', {
      workspaceId,
      messageId: message.id,
      retryAfterSeconds: dispatchAllowance.retryAfterSeconds,
    });
    throw new RateLimitError(
      dispatchAllowance.retryAfterSeconds,
      'This workspace is sending faster than we deliver. The message stays queued and will go out shortly.',
    );
  }

  const toPhone = conversation.contact.phoneE164;
  const provider = await getWhatsAppProvider({
    workspaceId,
    phoneRecordId: conversation.phoneNumberId,
    forceMeta: options?.providerOptions?.forceMeta,
    fetchFn: options?.providerOptions?.fetchFn,
  });

  // Monotonically advance to SENDING
  await updateMessageStatus(prisma, workspaceId, message.id, 'SENDING');

  let sendResult: ProviderSendResult;

  try {
    if (message.type === 'TEXT') {
      sendResult = await provider.sendText({
        toPhone,
        body: message.body ?? '',
        replyToProviderMessageId: message.replyToProviderMessageId ?? undefined,
      });
    } else if (message.type === 'TEMPLATE' && message.templateName) {
      sendResult = await provider.sendTemplate({
        toPhone,
        templateName: message.templateName,
        language: message.templateLanguage ?? 'en',
        components: message.payload ? [message.payload] : undefined,
      });
    } else {
      // Default to text if media details are not configured
      sendResult = await provider.sendText({
        toPhone,
        body: message.body ?? '',
        replyToProviderMessageId: message.replyToProviderMessageId ?? undefined,
      });
    }
  } catch (err) {
    const failure = classifySendFailure(err);
    await recordSendFailure(workspaceId, message, conversation.phoneNumberId, failure);
    throw err;
  }

  // The send happened. Everything below is bookkeeping about a message the customer can
  // already read, so none of it may be allowed to look like a send that did not occur.
  const updatedMessage = await persistDispatchResult(
    workspaceId,
    message,
    conversation.phoneNumberId,
    sendResult,
  );

  await touchConversationActivity(prisma, workspaceId, conversation.id, {
    lastMessageAt: sendResult.occurredAt,
    direction: 'OUTBOUND',
    firstResponse: !conversation.firstResponseAt,
    incrementCount: false,
  });

  await recordSendSuccess(workspaceId, message.type, conversation.phoneNumberId, sendResult);

  return updatedMessage ?? message;
}
