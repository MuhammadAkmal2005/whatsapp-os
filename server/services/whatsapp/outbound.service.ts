/**
 * Outbound WhatsApp Message Dispatch Service.
 *
 * Dispatches existing QUEUED outbound messages through the active WhatsAppProvider
 * without creating duplicate message records. Updates providerMessageId and
 * manages monotonic status advancement.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { isAppError, NotFoundError } from '@/server/errors';
import {
  findConversationById,
  touchConversationActivity,
} from '@/server/repositories/conversation.repository';
import {
  findMessageById,
  recordMessageDispatch,
  updateMessageStatus,
  type MessageWithDetailsRow,
} from '@/server/repositories/message.repository';
import {
  findPhoneNumberById,
  updateAccountError,
} from '@/server/repositories/whatsapp-account.repository';
import type { TenantContext } from '@/server/tenancy/context';
import { getWhatsAppProvider } from './provider.factory';
import type { ProviderSendResult } from './provider.interface';

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

  const conversation = await findConversationById(prisma, workspaceId, message.conversationId);
  if (!conversation) {
    throw new NotFoundError('Conversation');
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
    const errorCode = isAppError(err) ? err.code : 'DISPATCH_ERROR';
    const errorMsg = err instanceof Error ? err.message : 'Provider dispatch error';

    await updateMessageStatus(prisma, workspaceId, message.id, 'FAILED', {
      errorCode,
      errorMessage: errorMsg,
    });

    // If an account authentication failure occurred, mark WhatsAppAccount as ERROR
    if (
      conversation.phoneNumberId &&
      (errorCode === 'UNAUTHENTICATED' ||
        errorCode === 'FORBIDDEN' ||
        errorMsg.toLowerCase().includes('authentication') ||
        errorMsg.toLowerCase().includes('oauth'))
    ) {
      try {
        const phoneRecord = await findPhoneNumberById(prisma, workspaceId, conversation.phoneNumberId);
        if (phoneRecord) {
          await updateAccountError(prisma, workspaceId, phoneRecord.accountId, {
            lastErrorMessage: errorMsg,
          });
        }
      } catch {
        // Suppress secondary error updating account state
      }
    }

    throw err;
  }

  // Record providerMessageId and mark SENT
  const updatedMessage = await recordMessageDispatch(prisma, workspaceId, message.id, {
    providerMessageId: sendResult.providerMessageId,
    status: sendResult.status,
    sentAt: sendResult.occurredAt,
  });

  // Update conversation activity
  await touchConversationActivity(prisma, workspaceId, conversation.id, {
    lastMessageAt: sendResult.occurredAt,
    direction: 'OUTBOUND',
    firstResponse: !conversation.firstResponseAt,
    incrementCount: false,
  });

  return updatedMessage ?? message;
}
