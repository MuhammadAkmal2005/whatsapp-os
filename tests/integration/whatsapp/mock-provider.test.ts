import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { findContactByPhone } from '@/server/repositories/contact.repository';
import {
  createConversation,
  findActiveConversationForContact,
  findConversationById,
  updateConversation,
} from '@/server/repositories/conversation.repository';
import { findMessageById } from '@/server/repositories/message.repository';
import {
  createConversation as createConversationService,
} from '@/server/services/conversation/conversation.service';
import { sendMessage } from '@/server/services/conversation/message.service';
import {
  processInboundMessage,
  processStatusUpdate,
} from '@/server/services/whatsapp/inbound.service';
import { dispatchOutboundMessage } from '@/server/services/whatsapp/outbound.service';
import {
  getMockWhatsAppProvider,
  getWhatsAppProvider,
  resetMockWhatsAppProvider,
} from '@/server/services/whatsapp/provider.factory';
import {
  createContactFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '../fixtures';

describe('Phase 3 Unit 3: Mock WhatsApp Provider & Adapter Foundation', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockWhatsAppProvider();
  });

  describe('Inbound Message Processing', () => {
    it('creates a new contact and conversation on first inbound customer message', async () => {
      const ws = await createWorkspaceFixture();

      const result = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.test_inbound_1',
        fromPhone: '03001234567', // National PK format
        waProfileName: 'Zainab Bibi',
        body: 'Assalam-o-alaikum, is the embroidered lawn dress available?',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.messageId).toBeDefined();
      expect(result.conversationId).toBeDefined();
      expect(result.contactId).toBeDefined();

      // 1. Verify contact was created with normalized E.164 phone
      const contact = await findContactByPhone(prisma, ws.workspaceId, '+923001234567');
      expect(contact).not.toBeNull();
      expect(contact?.name).toBe('Zainab Bibi');
      expect(contact?.waProfileName).toBe('Zainab Bibi');
      expect(contact?.id).toBe(result.contactId);

      // 2. Verify conversation was created in OPEN status
      const conv = await findConversationById(prisma, ws.workspaceId, result.conversationId);
      expect(conv).not.toBeNull();
      expect(conv?.status).toBe('OPEN');
      expect(conv?.channel).toBe('WHATSAPP');
      expect(conv?.unreadCount).toBe(1);
      expect(conv?.messageCount).toBe(1);

      // 3. Verify message was recorded with RECEIVED status
      const msg = await findMessageById(prisma, ws.workspaceId, result.messageId);
      expect(msg).not.toBeNull();
      expect(msg?.direction).toBe('INBOUND');
      expect(msg?.status).toBe('RECEIVED');
      expect(msg?.body).toBe('Assalam-o-alaikum, is the embroidered lawn dress available?');
      expect(msg?.providerMessageId).toBe('wamid.test_inbound_1');
    });

    it('reuses existing contact and active conversation on subsequent messages', async () => {
      const ws = await createWorkspaceFixture();

      // Message 1
      const res1 = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.msg_seq_1',
        fromPhone: '+923001234567',
        waProfileName: 'Tariq Mehmood',
        body: 'Hello',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      // Message 2 from same customer
      const res2 = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.msg_seq_2',
        fromPhone: '0300 1234567', // Different formatting
        body: 'Do you ship to Lahore?',
        occurredAt: new Date('2026-08-28T10:01:00.000Z'),
      });

      expect(res2.contactId).toBe(res1.contactId);
      expect(res2.conversationId).toBe(res1.conversationId);
      expect(res2.messageId).not.toBe(res1.messageId);

      const conv = await findConversationById(prisma, ws.workspaceId, res1.conversationId);
      expect(conv?.unreadCount).toBe(2);
      expect(conv?.messageCount).toBe(2);
    });

    it('reopens a resolved or closed conversation when customer messages again', async () => {
      const ws = await createWorkspaceFixture();

      const res1 = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.msg_close_1',
        fromPhone: '+923001234567',
        body: 'Initial inquiry',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      // Close conversation
      await updateConversation(prisma, ws.workspaceId, res1.conversationId, { status: 'CLOSED' });

      let conv = await findConversationById(prisma, ws.workspaceId, res1.conversationId);
      expect(conv?.status).toBe('CLOSED');

      // Customer messages again
      await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.msg_reopen_2',
        fromPhone: '+923001234567',
        body: 'I have another question',
        occurredAt: new Date('2026-08-28T11:00:00.000Z'),
      });

      conv = await findConversationById(prisma, ws.workspaceId, res1.conversationId);
      expect(conv?.status).toBe('OPEN');
    });

    it('handles duplicate providerMessageId idempotently without throwing', async () => {
      const ws = await createWorkspaceFixture();

      const res1 = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.duplicate_test_100',
        fromPhone: '+923001234567',
        body: 'Idempotency test payload',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      expect(res1.isDuplicate).toBe(false);

      // Re-send with identical providerMessageId
      const res2 = await processInboundMessage(ws.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.duplicate_test_100',
        fromPhone: '+923001234567',
        body: 'Idempotency test payload',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      expect(res2.isDuplicate).toBe(true);
      expect(res2.messageId).toBe(res1.messageId);

      const conv = await findConversationById(prisma, ws.workspaceId, res1.conversationId);
      // Unread count should remain 1, not incremented twice
      expect(conv?.unreadCount).toBe(1);
      expect(conv?.messageCount).toBe(1);
    });
  });

  describe('Outbound Message Dispatch', () => {
    it('dispatches a queued outbound message through the mock provider', async () => {
      const ws = await createWorkspaceFixture();
      const contact = await createContactFixture(ws.workspaceId, {
        name: 'Sana Javed',
        phoneE164: '+923009876543',
      });
      const conv = await createConversationService(ws.context, { contactId: contact.id });

      // Create outbound message through message service
      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Your package is on its way via TCS courier.',
      });

      expect(message.status).toBe('QUEUED');

      // Dispatch through outbound service
      const dispatched = await dispatchOutboundMessage(ws.context, message.id);

      // Verification:
      // 1. Message status advanced to SENT
      expect(dispatched.status).toBe('SENT');
      expect(dispatched.sentAt).not.toBeNull();

      // 2. Provider message ID was assigned
      expect(dispatched.providerMessageId).toMatch(/^wamid\.mock_/);

      // 3. Provider logged the dispatch
      const mockProvider = getMockWhatsAppProvider();
      expect(mockProvider.getSentMessages()).toHaveLength(1);
      expect(mockProvider.getLastSent()?.toPhone).toBe('+923009876543');
    });

    it('dispatchOutboundMessage is idempotent and does not duplicate sends', async () => {
      const ws = await createWorkspaceFixture();
      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversationService(ws.context, { contactId: contact.id });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Dispatched once',
      });

      const dispatched = await dispatchOutboundMessage(ws.context, message.id);
      const providerId1 = dispatched.providerMessageId;
      const mockProvider = getMockWhatsAppProvider();
      expect(mockProvider.getSentMessages()).toHaveLength(1);

      // Second dispatch call on same message ID
      const redispatched = await dispatchOutboundMessage(ws.context, message.id);
      expect(redispatched.providerMessageId).toBe(providerId1);
      expect(mockProvider.getSentMessages()).toHaveLength(1); // No second send
    });
  });

  describe('Status Update Receipts & Monotonic Invariant', () => {
    it('progresses message status monotonically from SENT to DELIVERED and READ', async () => {
      const ws = await createWorkspaceFixture();
      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversationService(ws.context, { contactId: contact.id });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Delivery status tracking test',
      });

      const dispatched = await dispatchOutboundMessage(ws.context, message.id);
      const providerId = dispatched.providerMessageId!;

      // 1. Receive DELIVERED status receipt
      const delResult = await processStatusUpdate(ws.context, {
        type: 'STATUS',
        providerMessageId: providerId,
        status: 'DELIVERED',
        occurredAt: new Date('2026-08-28T12:00:00.000Z'),
      });

      expect(delResult.updated).toBe(true);

      let updated = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(updated?.status).toBe('DELIVERED');
      expect(updated?.deliveredAt).toEqual(new Date('2026-08-28T12:00:00.000Z'));

      // 2. Receive READ status receipt
      const readResult = await processStatusUpdate(ws.context, {
        type: 'STATUS',
        providerMessageId: providerId,
        status: 'READ',
        occurredAt: new Date('2026-08-28T12:05:00.000Z'),
      });

      expect(readResult.updated).toBe(true);

      updated = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(updated?.status).toBe('READ');
      expect(updated?.readAt).toEqual(new Date('2026-08-28T12:05:00.000Z'));

      // 3. Late arriving DELIVERED status does not regress status from READ
      const lateDelResult = await processStatusUpdate(ws.context, {
        type: 'STATUS',
        providerMessageId: providerId,
        status: 'DELIVERED',
        occurredAt: new Date('2026-08-28T12:00:00.000Z'),
      });

      expect(lateDelResult.reason).toBe('ALREADY_ADVANCED');

      updated = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(updated?.status).toBe('READ'); // Still READ
    });
  });

  describe('Tenant Isolation', () => {
    it('isolates inbound and outbound messages between workspaces', async () => {
      const wsA = await createWorkspaceFixture({ name: 'Workspace A' });
      const wsB = await createWorkspaceFixture({ name: 'Workspace B' });

      // Ingest message in Workspace A
      const resA = await processInboundMessage(wsA.context, {
        type: 'TEXT',
        providerMessageId: 'wamid.tenant_iso_1',
        fromPhone: '+923001111111',
        body: 'Workspace A message',
        occurredAt: new Date(),
      });

      // Workspace B cannot find message by provider ID
      const inB = await processStatusUpdate(wsB.context, {
        type: 'STATUS',
        providerMessageId: 'wamid.tenant_iso_1',
        status: 'DELIVERED',
        occurredAt: new Date(),
      });
      expect(inB.updated).toBe(false);
      expect(inB.reason).toBe('NOT_FOUND');

      // Workspace B cannot dispatch Workspace A message
      await expect(dispatchOutboundMessage(wsB.context, resA.messageId)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('Provider Factory & Mock Adapter', () => {
    it('resolves MockWhatsAppProvider in test environment', async () => {
      const provider = await getWhatsAppProvider();
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(getMockWhatsAppProvider().constructor);
    });
  });
});
