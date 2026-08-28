/**
 * Inbound WhatsApp Message & Event Processing Service.
 *
 * Ingests incoming WhatsApp messages from webhooks or mock simulators, resolves
 * or provisions the Contact in the current workspace, attaches or creates the
 * active Conversation thread, records the inbound Message, and updates
 * conversation activity counters.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { normalisePhone } from '@/lib/phone';
import { ValidationError } from '@/server/errors';
import {
  createContact,
  findContactByPhone,
  findDeletedContactByPhone,
  restoreContact,
  touchContactInteraction,
  updateContactWaProfile,
} from '@/server/repositories/contact.repository';
import {
  createConversation,
  findLatestConversationForContact,
  touchConversationActivity,
  updateConversation,
} from '@/server/repositories/conversation.repository';
import {
  createMessage,
  findMessageByProviderId,
  updateMessageStatus,
} from '@/server/repositories/message.repository';
import type { TenantContext } from '@/server/tenancy/context';
import type {
  InboundMediaMessage,
  InboundStatusUpdate,
  InboundTextMessage,
} from './provider.interface';

export type InboundProcessResult = {
  messageId: string;
  conversationId: string;
  contactId: string;
  isDuplicate: boolean;
};

export type StatusUpdateResult = {
  updated: boolean;
  messageId?: string;
  status?: string;
  reason?: 'NOT_FOUND' | 'ALREADY_ADVANCED';
};

/**
 * Ingests an inbound WhatsApp message into the workspace.
 *
 * Derives tenant isolation strictly from the provided context or workspace scope.
 * Guarantees idempotency on `providerMessageId` without throwing duplicate key errors.
 */
export async function processInboundMessage(
  ctxOrScope: TenantContext | { workspaceId: string },
  event: InboundTextMessage | InboundMediaMessage,
): Promise<InboundProcessResult> {
  const workspaceId = ctxOrScope.workspaceId;

  const phone = normalisePhone(event.fromPhone);
  if (!phone) {
    throw new ValidationError(`Invalid customer phone number: ${event.fromPhone}`);
  }

  // 1. Idempotency check: Return existing message if already received
  const existing = await findMessageByProviderId(prisma, workspaceId, event.providerMessageId);
  if (existing) {
    return {
      messageId: existing.id,
      conversationId: existing.conversationId,
      contactId: existing.senderContactId ?? '',
      isDuplicate: true,
    };
  }

  // 2. Resolve Contact
  let contact = await findContactByPhone(prisma, workspaceId, phone.e164);

  if (!contact) {
    // Check if soft-deleted contact exists and restore it
    const deleted = await findDeletedContactByPhone(prisma, workspaceId, phone.e164);
    if (deleted) {
      await restoreContact(prisma, workspaceId, deleted.id, {
        name: event.waProfileName ?? null,
        email: null,
        source: 'WHATSAPP',
        language: null,
        city: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
      });
      contact = await findContactByPhone(prisma, workspaceId, phone.e164);
    }
  }

  if (!contact) {
    // Create new customer record
    contact = await createContact(prisma, {
      workspaceId,
      phoneE164: phone.e164,
      name: event.waProfileName ?? null,
      waProfileName: event.waProfileName ?? null,
      email: null,
      source: 'WHATSAPP',
      language: null,
      city: null,
      addressLine1: null,
      addressLine2: null,
      postalCode: null,
    });
  } else if (event.waProfileName && !contact.waProfileName) {
    // Populate WhatsApp profile name if missing
    await updateContactWaProfile(prisma, workspaceId, contact.id, event.waProfileName);
  }

  // Update contact interaction time
  await touchContactInteraction(prisma, workspaceId, contact.id, event.occurredAt);

  // 3. Resolve active Conversation
  let conversation = await findLatestConversationForContact(
    prisma,
    workspaceId,
    contact.id,
    'WHATSAPP',
  );

  if (conversation) {
    // Reopen conversation if closed/resolved
    if (conversation.status === 'RESOLVED' || conversation.status === 'CLOSED') {
      await updateConversation(prisma, workspaceId, conversation.id, { status: 'OPEN' });
    }
  } else {
    // Create new conversation
    conversation = await createConversation(prisma, workspaceId, {
      contactId: contact.id,
      channel: 'WHATSAPP',
      status: 'OPEN',
      priority: 'NORMAL',
    });
  }

  // 4. Create Inbound Message
  const body = event.type === 'TEXT' ? event.body : event.caption ?? null;

  const message = await createMessage(prisma, workspaceId, {
    conversationId: conversation.id,
    direction: 'INBOUND',
    type: event.type,
    status: 'RECEIVED',
    body,
    providerMessageId: event.providerMessageId,
    replyToProviderMessageId: event.replyToProviderMessageId,
    senderContactId: contact.id,
    occurredAt: event.occurredAt,
  });

  // 5. Update Conversation Activity and unread counters
  await touchConversationActivity(prisma, workspaceId, conversation.id, {
    lastMessageAt: event.occurredAt,
    direction: 'INBOUND',
    unreadDelta: 1,
  });

  return {
    messageId: message.id,
    conversationId: conversation.id,
    contactId: contact.id,
    isDuplicate: false,
  };
}

/**
 * Processes an inbound message status delivery/read receipt from WhatsApp.
 */
export async function processStatusUpdate(
  ctxOrScope: TenantContext | { workspaceId: string },
  update: InboundStatusUpdate,
): Promise<StatusUpdateResult> {
  const workspaceId = ctxOrScope.workspaceId;

  const message = await findMessageByProviderId(prisma, workspaceId, update.providerMessageId);
  if (!message) {
    return { updated: false, reason: 'NOT_FOUND' };
  }

  const updatedCount = await updateMessageStatus(
    prisma,
    workspaceId,
    message.id,
    update.status,
    {
      occurredAt: update.occurredAt,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
    },
  );

  return {
    updated: updatedCount > 0,
    messageId: message.id,
    status: update.status,
    reason: updatedCount === 0 ? 'ALREADY_ADVANCED' : undefined,
  };
}
