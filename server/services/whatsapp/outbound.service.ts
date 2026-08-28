/**
 * Outbound WhatsApp Message Dispatch Service.
 *
 * Dispatches existing QUEUED outbound messages through the active WhatsAppProvider
 * without creating duplicate message records. Updates providerMessageId and
 * manages monotonic status advancement.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
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
import type { TenantContext } from '@/server/tenancy/context';
import { getWhatsAppProvider } from './provider.factory';
import type { ProviderSendResult } from './provider.interface';

/**
 * Dispatches an already-created outbound message to the WhatsApp provider.
 *
 * Scopes operation strictly to `ctx.workspaceId` and ensures idempotent dispatch.
 */
export async function dispatchOutboundMessage(
  ctxOrScope: TenantContext | { workspaceId: string },
  messageId: string,
): Promise<MessageWithDetailsRow> {
  const workspaceId = ctxOrScope.workspaceId;

  const message = await findMessageById(prisma, workspaceId, messageId);
  if (!message) {
    throw new NotFoundError('Message');
  }

  // Idempotency check: If already dispatched, return existing message without re-sending
  if (
    message.providerMessageId &&
    (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'READ')
  ) {
    return message;
  }

  const conversation = await findConversationById(prisma, workspaceId, message.conversationId);
  if (!conversation) {
    throw new NotFoundError('Conversation');
  }

  const toPhone = conversation.contact.phoneE164;
  const provider = getWhatsAppProvider();

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
    const errorMsg = err instanceof Error ? err.message : 'Provider dispatch error';
    await updateMessageStatus(prisma, workspaceId, message.id, 'FAILED', {
      errorCode: 'DISPATCH_ERROR',
      errorMessage: errorMsg,
    });
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
