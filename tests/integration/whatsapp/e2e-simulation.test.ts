import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { findContactByPhone } from '@/server/repositories/contact.repository';
import { findMessageById } from '@/server/repositories/message.repository';
import {
  getConversation,
  listConversations,
} from '@/server/services/conversation/conversation.service';
import {
  listMessages,
  sendMessage,
} from '@/server/services/conversation/message.service';
import {
  processInboundMessage,
  processStatusUpdate,
} from '@/server/services/whatsapp/inbound.service';
import { dispatchOutboundMessage } from '@/server/services/whatsapp/outbound.service';
import {
  getMockWhatsAppProvider,
  resetMockWhatsAppProvider,
} from '@/server/services/whatsapp/provider.factory';
import {
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

describe('Phase 3 Unit 4: End-to-End WhatsApp Simulation Flow', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockWhatsAppProvider();
  });

  it('completes the entire simulated inbound -> inbox -> outbound reply -> status receipts lifecycle', async () => {
    const ws = await createWorkspaceFixture({ name: 'Simulated Apparel Store' });

    const inboundTime = new Date('2026-08-28T10:00:00.000Z');

    // 1. Mock customer inbound message
    const inboundResult = await processInboundMessage(ws.context, {
      type: 'TEXT',
      providerMessageId: 'wamid.sim_in_101',
      fromPhone: '+923009876543',
      waProfileName: 'Ayesha Siddiqua',
      body: 'Assalam-o-Alaikum, is the stitched 3-piece lawn available in Medium?',
      occurredAt: inboundTime,
    });

    expect(inboundResult.isDuplicate).toBe(false);
    expect(inboundResult.conversationId).toBeDefined();
    expect(inboundResult.contactId).toBeDefined();

    // 2. Contact created & resolved with normalized E.164 phone
    const contact = await findContactByPhone(prisma, ws.workspaceId, '+923009876543');
    expect(contact).not.toBeNull();
    expect(contact?.name).toBe('Ayesha Siddiqua');
    expect(contact?.waProfileName).toBe('Ayesha Siddiqua');
    expect(contact?.lastInteractionAt).toEqual(inboundTime);

    // 3. WhatsApp conversation created/reused
    const conv = await getConversation(ws.context, inboundResult.conversationId);
    expect(conv).not.toBeNull();
    expect(conv.contactId).toBe(contact!.id);
    expect(conv.channel).toBe('WHATSAPP');
    expect(conv.status).toBe('OPEN');

    // 4. Inbound Message created with valid inbound status (RECEIVED)
    const inboundMsg = await findMessageById(prisma, ws.workspaceId, inboundResult.messageId);
    expect(inboundMsg).not.toBeNull();
    expect(inboundMsg?.direction).toBe('INBOUND');
    expect(inboundMsg?.status).toBe('RECEIVED');
    expect(inboundMsg?.body).toBe('Assalam-o-Alaikum, is the stitched 3-piece lawn available in Medium?');
    expect(inboundMsg?.providerMessageId).toBe('wamid.sim_in_101');

    // 5. Conversation becomes visible through existing conversation queries
    const inboxPage = await listConversations(ws.context, {});
    expect(inboxPage.conversations).toHaveLength(1);
    expect(inboxPage.conversations[0]?.id).toBe(conv.id);

    // 6. Correct unread/message counters and timestamps
    expect(inboxPage.conversations[0]?.unreadCount).toBe(1);
    expect(inboxPage.conversations[0]?.messageCount).toBe(1);
    expect(conv.unreadCount).toBe(1);
    expect(conv.messageCount).toBe(1);
    expect(conv.lastInboundAt).toEqual(inboundTime);
    expect(conv.lastMessageAt).toEqual(inboundTime);
    expect(conv.lastOutboundAt).toBeNull();
    expect(conv.firstResponseAt).toBeNull();

    // 7. Business outbound reply creates exactly ONE QUEUED Message
    const replySendTime = new Date('2026-08-28T10:05:00.000Z');
    const queuedMessage = await sendMessage(ws.context, {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      body: 'Walaikum Assalam Ayesha! Yes, Medium is in stock for Rs. 4,500 with Cash on Delivery.',
    });

    expect(queuedMessage.status).toBe('QUEUED');
    expect(queuedMessage.providerMessageId).toBeNull();

    // Verify exactly 2 messages in conversation thread before dispatch
    let threadMessages = await listMessages(ws.context, { conversationId: conv.id });
    expect(threadMessages.rows).toHaveLength(2);

    // 8. dispatchOutboundMessage updates that SAME record
    const dispatched = await dispatchOutboundMessage(ws.context, queuedMessage.id);

    // 9. No duplicate Message is created
    threadMessages = await listMessages(ws.context, { conversationId: conv.id });
    expect(threadMessages.rows).toHaveLength(2);

    // 10. providerMessageId is assigned
    expect(dispatched.providerMessageId).toBeDefined();
    expect(dispatched.providerMessageId).toMatch(/^wamid\.mock_/);

    // 11. Outbound status becomes SENT
    expect(dispatched.status).toBe('SENT');
    expect(dispatched.sentAt).not.toBeNull();

    // Verify MockWhatsAppProvider received the exact payload
    const mockProvider = getMockWhatsAppProvider();
    expect(mockProvider.getSentMessages()).toHaveLength(1);
    expect(mockProvider.getLastSent()?.toPhone).toBe('+923009876543');
    expect((mockProvider.getLastSent()?.params as { body?: string })?.body).toBe(
      'Walaikum Assalam Ayesha! Yes, Medium is in stock for Rs. 4,500 with Cash on Delivery.',
    );

    // 12. Simulate DELIVERED receipt
    const deliveredTime = new Date('2026-08-28T10:05:30.000Z');
    const delResult = await processStatusUpdate(ws.context, {
      type: 'STATUS',
      providerMessageId: dispatched.providerMessageId!,
      status: 'DELIVERED',
      occurredAt: deliveredTime,
    });
    expect(delResult.updated).toBe(true);

    // 13. Verify deliveredAt
    let updatedMsg = await findMessageById(prisma, ws.workspaceId, queuedMessage.id);
    expect(updatedMsg?.status).toBe('DELIVERED');
    expect(updatedMsg?.deliveredAt).toEqual(deliveredTime);

    // 14. Simulate READ receipt
    const readTime = new Date('2026-08-28T10:06:00.000Z');
    const readResult = await processStatusUpdate(ws.context, {
      type: 'STATUS',
      providerMessageId: dispatched.providerMessageId!,
      status: 'READ',
      occurredAt: readTime,
    });
    expect(readResult.updated).toBe(true);

    // 15. Verify readAt
    updatedMsg = await findMessageById(prisma, ws.workspaceId, queuedMessage.id);
    expect(updatedMsg?.status).toBe('READ');
    expect(updatedMsg?.readAt).toEqual(readTime);

    // 16. Send an out-of-order DELIVERED receipt after READ and verify status remains READ
    const lateDeliveredResult = await processStatusUpdate(ws.context, {
      type: 'STATUS',
      providerMessageId: dispatched.providerMessageId!,
      status: 'DELIVERED',
      occurredAt: deliveredTime,
    });
    expect(lateDeliveredResult.reason).toBe('ALREADY_ADVANCED');

    updatedMsg = await findMessageById(prisma, ws.workspaceId, queuedMessage.id);
    expect(updatedMsg?.status).toBe('READ');

    // 17. Verify all conversation and message metrics
    const finalConv = await getConversation(ws.context, conv.id);
    expect(finalConv.unreadCount).toBe(0); // Cleared automatically when agent opened the message thread via listMessages
    expect(finalConv.messageCount).toBe(2); // Inbound + Outbound (incrementCount: false on dispatch avoided double count)
    expect(finalConv.lastInboundAt).toEqual(inboundTime);
    expect(finalConv.lastOutboundAt).not.toBeNull();
    expect(finalConv.firstResponseAt).not.toBeNull();
    expect(updatedMsg?.deliveredAt).toEqual(deliveredTime);
    expect(updatedMsg?.readAt).toEqual(readTime);
  });

  it('enforces strict tenant isolation across all simulation operations', async () => {
    const wsA = await createWorkspaceFixture({ name: 'Tenant A Store' });
    const wsB = await createWorkspaceFixture({ name: 'Tenant B Store' });

    // Workspace A processes inbound message
    const resA = await processInboundMessage(wsA.context, {
      type: 'TEXT',
      providerMessageId: 'wamid.iso_test_001',
      fromPhone: '+923001112233',
      waProfileName: 'Customer A',
      body: 'Private message for Tenant A',
      occurredAt: new Date(),
    });

    // 18. Verify Workspace B cannot read Workspace A conversation
    await expect(getConversation(wsB.context, resA.conversationId)).rejects.toThrow(
      NotFoundError,
    );

    const listB = await listConversations(wsB.context, {});
    expect(listB.conversations).toHaveLength(0);

    // Verify Workspace B cannot access Workspace A messages
    await expect(
      listMessages(wsB.context, { conversationId: resA.conversationId }),
    ).rejects.toThrow(NotFoundError);

    // Verify Workspace B cannot dispatch Workspace A message
    await expect(dispatchOutboundMessage(wsB.context, resA.messageId)).rejects.toThrow(
      NotFoundError,
    );

    // Verify Workspace B cannot mutate Workspace A receipt state
    const receiptB = await processStatusUpdate(wsB.context, {
      type: 'STATUS',
      providerMessageId: 'wamid.iso_test_001',
      status: 'READ',
      occurredAt: new Date(),
    });
    expect(receiptB.updated).toBe(false);
    expect(receiptB.reason).toBe('NOT_FOUND');
  });
});
