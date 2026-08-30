import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/db/prisma';
import { ValidationError } from '@/server/errors';
import { whatsappWebhookHandler } from '@/server/jobs/handlers/whatsapp-webhook.handler';
import type { JobContext } from '@/server/jobs/registry';
import * as inboundService from '@/server/services/whatsapp/inbound.service';
import { processWebhookEvent } from '@/server/services/whatsapp/webhook-processor.service';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';

const dummyContext: JobContext = {
  jobId: 'test-job-id',
  attempt: 1,
  maxAttempts: 8,
  signal: new AbortController().signal,
};

describe('Webhook Processor Service Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.restoreAllMocks();
  });

  // 1. known phone_number_id routes to correct workspace
  it('1. routes known phone_number_id to correct workspace', async () => {
    const fixtureA = await createWorkspaceFixture();
    const fixtureB = await createWorkspaceFixture();

    const accountA = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixtureA.workspaceId,
        wabaId: 'waba_ws_a',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixtureA.workspaceId,
        accountId: accountA.id,
        phoneNumberId: 'pn_ws_a',
        displayPhoneNumber: '+923001111111',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.route_test_001',
        phoneNumberId: 'pn_ws_a',
        eventType: 'message',
        payload: {
          id: 'wamid.route_test_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Routing test' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updatedEvent?.status).toBe('PROCESSED');
    expect(updatedEvent?.workspaceId).toBe(fixtureA.workspaceId);

    // Records created in workspace A
    const msgA = await prisma.message.findFirst({ where: { workspaceId: fixtureA.workspaceId } });
    expect(msgA).not.toBeNull();

    // No records created in workspace B
    const msgB = await prisma.message.findFirst({ where: { workspaceId: fixtureB.workspaceId } });
    expect(msgB).toBeNull();
  });

  // 2. unknown phone_number_id -> IGNORED
  it('2. marks WebhookEvent IGNORED when phone_number_id is unknown', async () => {
    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.unknown_pn_001',
        phoneNumberId: 'pn_non_existent',
        eventType: 'message',
        payload: {
          id: 'wamid.unknown_pn_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Hello?' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updatedEvent?.status).toBe('IGNORED');
    expect(updatedEvent?.workspaceId).toBeNull();
    expect(updatedEvent?.error).toContain('Unknown phone_number_id');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'whatsapp.webhook.ignored' },
    });
    expect(audit).not.toBeNull();
  });

  // 3. disconnected/inactive account -> IGNORED
  it('3. marks WebhookEvent IGNORED when account/phone is DISCONNECTED or inactive', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_disc_123',
        status: 'DISCONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_disc_123',
        displayPhoneNumber: '+923001234567',
        status: 'DISCONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.disc_msg_001',
        phoneNumberId: 'pn_disc_123',
        eventType: 'message',
        payload: {
          id: 'wamid.disc_msg_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Hello' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updatedEvent?.status).toBe('IGNORED');
    expect(updatedEvent?.workspaceId).toBe(fixture.workspaceId);
    expect(updatedEvent?.error).toContain('Channel or account not connected');
  });

  // 4. inbound text -> Contact + Conversation + Message
  it('4. processes inbound text creating Contact, Conversation, and Message', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_inbound_1',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_inbound_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.inbound_text_001',
        phoneNumberId: 'pn_inbound_1',
        eventType: 'message',
        payload: {
          id: 'wamid.inbound_text_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Assalam o Alaikum, what is the price of black kurta?' },
          contacts: [{ profile: { name: 'Usman Ali' }, wa_id: '923009998877' }],
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    // Contact created
    const contact = await prisma.contact.findFirst({
      where: { workspaceId: fixture.workspaceId, phoneE164: '+923009998877' },
    });
    expect(contact).not.toBeNull();
    expect(contact?.name).toBe('Usman Ali');

    // Conversation created
    const conversation = await prisma.conversation.findFirst({
      where: { workspaceId: fixture.workspaceId, contactId: contact!.id },
    });
    expect(conversation).not.toBeNull();
    expect(conversation?.status).toBe('OPEN');

    // Message created
    const message = await prisma.message.findFirst({
      where: { workspaceId: fixture.workspaceId, providerMessageId: 'wamid.inbound_text_001' },
    });
    expect(message).not.toBeNull();
    expect(message?.body).toBe('Assalam o Alaikum, what is the price of black kurta?');
    expect(message?.direction).toBe('INBOUND');
    expect(message?.status).toBe('RECEIVED');
  });

  // 5. duplicate inbound job is idempotent
  it('5. duplicate inbound message is idempotent', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_idempotent_1',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_idempotent_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event1 = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.idempotent_001',
        phoneNumberId: 'pn_idempotent_1',
        eventType: 'message',
        payload: {
          id: 'wamid.idempotent_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'First delivery attempt' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event1.id, dummyContext);

    // Second webhook event with identical message id
    const event2 = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.idempotent_001_retry',
        phoneNumberId: 'pn_idempotent_1',
        eventType: 'message',
        payload: {
          id: 'wamid.idempotent_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'First delivery attempt' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event2.id, dummyContext);

    const messageCount = await prisma.message.count({
      where: { workspaceId: fixture.workspaceId, providerMessageId: 'wamid.idempotent_001' },
    });
    expect(messageCount).toBe(1);

    const contactCount = await prisma.contact.count({
      where: { workspaceId: fixture.workspaceId, phoneE164: '+923009998877' },
    });
    expect(contactCount).toBe(1);
  });

  // 6. already PROCESSED event is a no-op
  it('6. already PROCESSED event is a clean no-op', async () => {
    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.already_done',
        phoneNumberId: 'pn_123',
        eventType: 'message',
        payload: { id: 'wamid.already_done' },
        signatureValid: true,
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const updated = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updated?.status).toBe('PROCESSED');
  });

  // 7. valid status updates Message
  it('7. valid status updates outbound message status', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_status_1',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_status_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const contact = await prisma.contact.create({
      data: {
        workspaceId: fixture.workspaceId,
        phoneE164: '+923005554433',
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: fixture.workspaceId,
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
      },
    });

    const message = await prisma.message.create({
      data: {
        workspaceId: fixture.workspaceId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        body: 'Your order has shipped!',
        providerMessageId: 'wamid.status_update_001',
      },
    });

    const statusEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.status_update_001:delivered',
        phoneNumberId: 'pn_status_1',
        eventType: 'status',
        payload: {
          id: 'wamid.status_update_001',
          status: 'delivered',
          timestamp: '1724800500',
          recipient_id: '923005554433',
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(statusEvent.id, dummyContext);

    const updatedMessage = await prisma.message.findUnique({ where: { id: message.id } });
    expect(updatedMessage?.status).toBe('DELIVERED');
    expect(updatedMessage?.deliveredAt).not.toBeNull();
  });

  // 8. out-of-order READ then DELIVERED remains READ
  it('8. out-of-order READ then DELIVERED preserves monotonic state and remains READ', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_monotonic_1',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_monotonic_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const contact = await prisma.contact.create({
      data: {
        workspaceId: fixture.workspaceId,
        phoneE164: '+923005559988',
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: fixture.workspaceId,
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
      },
    });

    const message = await prisma.message.create({
      data: {
        workspaceId: fixture.workspaceId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        body: 'Monotonic test',
        providerMessageId: 'wamid.monotonic_001',
      },
    });

    // 1. READ event arrives first
    const readEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.monotonic_001:read',
        phoneNumberId: 'pn_monotonic_1',
        eventType: 'status',
        payload: {
          id: 'wamid.monotonic_001',
          status: 'read',
          timestamp: '1724800600',
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(readEvent.id, dummyContext);

    const messageAfterRead = await prisma.message.findUnique({ where: { id: message.id } });
    expect(messageAfterRead?.status).toBe('READ');
    expect(messageAfterRead?.readAt).not.toBeNull();

    // 2. DELIVERED event arrives second (out-of-order)
    const deliveredEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.monotonic_001:delivered',
        phoneNumberId: 'pn_monotonic_1',
        eventType: 'status',
        payload: {
          id: 'wamid.monotonic_001',
          status: 'delivered',
          timestamp: '1724800550',
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(deliveredEvent.id, dummyContext);

    const messageAfterDelivered = await prisma.message.findUnique({ where: { id: message.id } });
    expect(messageAfterDelivered?.status).toBe('READ');
  });

  // 9. unknown providerMessageId status is safely ignored/processed
  it('9. unknown providerMessageId status update completes as PROCESSED without throwing', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_unknown_msg_status',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_unknown_msg_status',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const statusEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.non_existent_msg_123:delivered',
        phoneNumberId: 'pn_unknown_msg_status',
        eventType: 'status',
        payload: {
          id: 'wamid.non_existent_msg_123',
          status: 'delivered',
          timestamp: '1724800500',
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(statusEvent.id, dummyContext);

    const updated = await prisma.webhookEvent.findUnique({ where: { id: statusEvent.id } });
    expect(updated?.status).toBe('PROCESSED');
  });

  // 10. validation failure -> FAILED without endless retries
  it('10. validation failure marks WebhookEvent as FAILED without throwing worker loop error', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_validation_fail',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_validation_fail',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    // Invalid from phone number that fails E164 validation
    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.invalid_phone_001',
        phoneNumberId: 'pn_validation_fail',
        eventType: 'message',
        payload: {
          id: 'wamid.invalid_phone_001',
          from: 'invalid-not-a-number',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Hello' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    // Should complete cleanly (not rethrow) so worker doesn't retry forever
    await processWebhookEvent(event.id, dummyContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updatedEvent?.status).toBe('FAILED');
    expect(updatedEvent?.error).toContain('Invalid customer phone number');
  });

  // 11. transient DB failure can propagate for queue retry
  it('11. transient DB failure re-throws for queue retry and logs error', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: {
        workspaceId: fixture.workspaceId,
        wabaId: 'waba_transient_1',
        status: 'CONNECTED',
      },
    });

    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_transient_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.transient_fail_001',
        phoneNumberId: 'pn_transient_1',
        eventType: 'message',
        payload: {
          id: 'wamid.transient_fail_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Hello' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    // Mock processInboundMessage to simulate transient DB disconnect
    vi.spyOn(inboundService, 'processInboundMessage').mockRejectedValueOnce(
      new Error('Database connection reset'),
    );

    await expect(processWebhookEvent(event.id, dummyContext)).rejects.toThrow(
      'Database connection reset',
    );

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updatedEvent?.error).toBe('Database connection reset');
  });

  // 12. cross-tenant isolation
  it('12. enforces cross-tenant isolation between workspaces', async () => {
    const fixtureA = await createWorkspaceFixture();
    const fixtureB = await createWorkspaceFixture();

    const accountA = await prisma.whatsAppAccount.create({
      data: { workspaceId: fixtureA.workspaceId, wabaId: 'waba_iso_a', status: 'CONNECTED' },
    });
    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixtureA.workspaceId,
        accountId: accountA.id,
        phoneNumberId: 'pn_iso_a',
        displayPhoneNumber: '+923001111111',
        status: 'CONNECTED',
      },
    });

    const accountB = await prisma.whatsAppAccount.create({
      data: { workspaceId: fixtureB.workspaceId, wabaId: 'waba_iso_b', status: 'CONNECTED' },
    });
    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixtureB.workspaceId,
        accountId: accountB.id,
        phoneNumberId: 'pn_iso_b',
        displayPhoneNumber: '+923002222222',
        status: 'CONNECTED',
      },
    });

    // Inbound to Workspace A
    const eventA = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.iso_msg_001',
        phoneNumberId: 'pn_iso_a',
        eventType: 'message',
        payload: {
          id: 'wamid.iso_msg_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Message for Workspace A' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(eventA.id, dummyContext);

    // Workspace A has 1 message, Workspace B has 0 messages
    const countA = await prisma.message.count({ where: { workspaceId: fixtureA.workspaceId } });
    const countB = await prisma.message.count({ where: { workspaceId: fixtureB.workspaceId } });
    expect(countA).toBe(1);
    expect(countB).toBe(0);
  });

  // 13. WebhookEvent lifecycle transitions are correct
  it('13. correctly performs WebhookEvent lifecycle transitions', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: { workspaceId: fixture.workspaceId, wabaId: 'waba_lifecycle_1', status: 'CONNECTED' },
    });
    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_lifecycle_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.lifecycle_001',
        phoneNumberId: 'pn_lifecycle_1',
        eventType: 'message',
        payload: {
          id: 'wamid.lifecycle_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Lifecycle test' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    expect(event.status).toBe('RECEIVED');
    expect(event.processedAt).toBeNull();

    await processWebhookEvent(event.id, dummyContext);

    const updated = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updated?.status).toBe('PROCESSED');
    expect(updated?.processedAt).not.toBeNull();
    expect(updated?.error).toBeNull();
  });

  // 14. it now creates AI jobs unconditionally because AI routing is live
  it('14. creates an AI job for inbound messages', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: { workspaceId: fixture.workspaceId, wabaId: 'waba_no_ai_1', status: 'CONNECTED' },
    });
    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_no_ai_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.no_ai_001',
        phoneNumberId: 'pn_no_ai_1',
        eventType: 'message',
        payload: {
          id: 'wamid.no_ai_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'text',
          text: { body: 'Do not trigger AI' },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const aiJobs = await prisma.job.findMany({
      where: { type: 'ai.respond' },
    });
    expect(aiJobs.length).toBe(1);
  });

  // 15. no media download jobs are created
  it('15. does NOT create any media download jobs for inbound media', async () => {
    const fixture = await createWorkspaceFixture();

    const account = await prisma.whatsAppAccount.create({
      data: { workspaceId: fixture.workspaceId, wabaId: 'waba_no_media_job_1', status: 'CONNECTED' },
    });
    await prisma.whatsAppPhoneNumber.create({
      data: {
        workspaceId: fixture.workspaceId,
        accountId: account.id,
        phoneNumberId: 'pn_no_media_job_1',
        displayPhoneNumber: '+923001234567',
        status: 'CONNECTED',
      },
    });

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'whatsapp',
        providerEventId: 'wamid.no_media_001',
        phoneNumberId: 'pn_no_media_job_1',
        eventType: 'message',
        payload: {
          id: 'wamid.no_media_001',
          from: '923009998877',
          timestamp: '1724800000',
          type: 'image',
          image: {
            id: 'media_meta_id_123',
            mime_type: 'image/jpeg',
            caption: 'Receipt',
          },
        },
        signatureValid: true,
        status: 'RECEIVED',
      },
    });

    await processWebhookEvent(event.id, dummyContext);

    const mediaJobs = await prisma.job.findMany({
      where: { type: 'whatsapp.download_media' },
    });
    expect(mediaJobs.length).toBe(0);
  });

  // Job Handler delegation and validation
  it('whatsappWebhookHandler validates payload and delegates to processWebhookEvent', async () => {
    await expect(
      whatsappWebhookHandler({ webhookEventId: '' } as any, dummyContext),
    ).rejects.toThrow(ValidationError);

    await expect(
      whatsappWebhookHandler(null as any, dummyContext),
    ).rejects.toThrow(ValidationError);
  });
});
