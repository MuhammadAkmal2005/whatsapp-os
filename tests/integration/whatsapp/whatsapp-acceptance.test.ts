import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/webhooks/whatsapp/route';
import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { decryptSecret } from '@/lib/crypto';
import { NotConfiguredError, NotFoundError, ProviderError } from '@/server/errors';
import { whatsappWebhookHandler } from '@/server/jobs/handlers/whatsapp-webhook.handler';
import type { JobContext } from '@/server/jobs/registry';
import { findAccountById, findPhoneNumberById } from '@/server/repositories/whatsapp-account.repository';
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
import { dispatchOutboundMessage } from '@/server/services/whatsapp/outbound.service';
import {
  getMockWhatsAppProvider,
  resetMockWhatsAppProvider,
} from '@/server/services/whatsapp/provider.factory';
import { signWebhookBody } from '@/services/whatsapp/signature';
import {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
  getWhatsAppAccountOverview,
} from '@/server/services/whatsapp/whatsapp-account.service';
import {
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

const APP_SECRET = env.META_APP_SECRET ?? 'test-app-secret-12345';

const dummyJobContext: JobContext = {
  jobId: 'acceptance-job-id',
  attempt: 1,
  maxAttempts: 8,
  signal: new AbortController().signal,
};

function createSignedWebhookRequest(
  body: string,
  secret = APP_SECRET,
  headers: Record<string, string> = {},
): Request {
  const signature = signWebhookBody(body, secret);
  return new Request('http://localhost:3000/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
      ...headers,
    },
    body,
  });
}

describe('Phase 4 Unit 5: Master WhatsApp Text Acceptance Suite', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockWhatsAppProvider();
    vi.restoreAllMocks();
  });

  // ── 1. ACCOUNT CONFIGURATION → CREDENTIAL SECURITY ──────────────────────────
  it('1. connects WhatsApp account and persists encrypted credentials with zero secret leakage', async () => {
    const ws = await createWorkspaceFixture({ name: 'Akmal Luxury Lawn' });
    const secretToken = 'EAAG_acceptance_live_token_987654321';

    const accountDTO = await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_acc_1001',
        phoneNumberId: 'pn_acc_1001',
        displayPhoneNumber: '+92 300 1234567',
        accessToken: secretToken,
        displayName: 'Akmal Luxury Support',
      },
      { forceMock: true },
    );

    expect(accountDTO.status).toBe('CONNECTED');
    expect(accountDTO.wabaId).toBe('waba_acc_1001');
    expect(accountDTO.phoneNumbers[0]?.phoneNumberId).toBe('pn_acc_1001');
    expect((accountDTO as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    expect((accountDTO as unknown as Record<string, unknown>).accessTokenEncrypted).toBeUndefined();

    // Verify DB level encryption
    const dbAccount = await prisma.whatsAppAccount.findUnique({
      where: { id: accountDTO.id },
    });
    expect(dbAccount).not.toBeNull();
    expect(dbAccount?.accessTokenEncrypted).not.toBeNull();
    expect(dbAccount?.accessTokenEncrypted?.startsWith('v1:')).toBe(true);
    expect(dbAccount?.accessTokenEncrypted).not.toContain(secretToken);

    // Verify token can be decrypted only with AUTH_SECRET
    const decrypted = decryptSecret(dbAccount!.accessTokenEncrypted!, env.AUTH_SECRET);
    expect(decrypted).toBe(secretToken);

    // Verify overview DTO omits secrets
    const overview = await getWhatsAppAccountOverview(ws.context);
    expect(overview).toHaveLength(1);
    expect(overview[0]?.id).toBe(accountDTO.id);
    expect((overview[0] as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    expect((overview[0] as unknown as Record<string, unknown>).accessTokenEncrypted).toBeUndefined();

    // Verify audit log has no plaintext token
    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, action: 'whatsapp.account.connected' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain(secretToken);
  });

  // ── 2. INBOUND WEBHOOK → DOMAIN ENTITIES ─────────────────────────────────────
  it('2. receives signed inbound webhook, enqueues job, and creates Contact, Conversation, and Message', async () => {
    const ws = await createWorkspaceFixture({ name: 'Eastern Pret Boutique' });
    const phoneNumberId = 'pn_inbound_2001';
    const customerPhone = '+923009876543';
    const wamid = `wamid.acceptance_in_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_inbound_2001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 5551122',
        accessToken: 'EAAG_inbound_test_token',
      },
      { forceMock: true },
    );

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Zainab Bibi' }, wa_id: '923009876543' }],
                messages: [
                  {
                    from: '923009876543',
                    id: wamid,
                    timestamp: '1724800000',
                    type: 'text',
                    text: { body: 'Assalam o Alaikum, is the embroidered chiffon suit in stock?' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Step 1: POST to HTTP Webhook Route
    const req = createSignedWebhookRequest(JSON.stringify(payload));
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Assert WebhookEvent and Job were created atomically
    const event = await prisma.webhookEvent.findFirst({
      where: { providerEventId: wamid },
    });
    expect(event).not.toBeNull();
    expect(event?.status).toBe('RECEIVED');
    expect(event?.phoneNumberId).toBe(phoneNumberId);
    expect(event?.workspaceId).toBeNull(); // Tenant resolution is deferred to the job

    const job = await prisma.job.findFirst({
      where: { dedupeKey: `whatsapp.process_webhook:${event?.id}` },
    });
    expect(job).not.toBeNull();
    expect(job?.type).toBe('whatsapp.process_webhook');
    expect(job?.status).toBe('PENDING');

    // Step 2: Execute background job handler
    await whatsappWebhookHandler({ webhookEventId: event!.id }, dummyJobContext);

    // Verify WebhookEvent advanced to PROCESSED
    const processedEvent = await prisma.webhookEvent.findUnique({ where: { id: event!.id } });
    expect(processedEvent?.status).toBe('PROCESSED');
    expect(processedEvent?.workspaceId).toBe(ws.workspaceId);
    expect(processedEvent?.processedAt).not.toBeNull();

    // Verify Contact created with E.164 normalization and profile name
    const contact = await findContactByPhone(prisma, ws.workspaceId, customerPhone);
    expect(contact).not.toBeNull();
    expect(contact?.name).toBe('Zainab Bibi');
    expect(contact?.waProfileName).toBe('Zainab Bibi');

    // Verify Conversation created in OPEN state
    const conversation = await prisma.conversation.findFirst({
      where: { workspaceId: ws.workspaceId, contactId: contact!.id },
    });
    expect(conversation).not.toBeNull();
    expect(conversation?.channel).toBe('WHATSAPP');
    expect(conversation?.status).toBe('OPEN');
    expect(conversation?.unreadCount).toBe(1);
    expect(conversation?.messageCount).toBe(1);
    expect(conversation?.lastInboundAt).not.toBeNull();

    // Verify Message created in RECEIVED state
    const message = await prisma.message.findFirst({
      where: { workspaceId: ws.workspaceId, providerMessageId: wamid },
    });
    expect(message).not.toBeNull();
    expect(message?.direction).toBe('INBOUND');
    expect(message?.status).toBe('RECEIVED');
    expect(message?.body).toBe('Assalam o Alaikum, is the embroidered chiffon suit in stock?');
  });

  // ── 3. INBOX READ PATH & UNREAD COUNTER CLEARING ────────────────────────────
  it('3. serves conversation in inbox queries, verifies metrics, and clears unreadCount on read', async () => {
    const ws = await createWorkspaceFixture({ name: 'Retail Store' });
    const phoneNumberId = 'pn_inbox_3001';
    const customerPhone = '+923005556677';
    const wamid = `wamid.inbox_test_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_inbox_3001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 5556677',
        accessToken: 'EAAG_inbox_test_token',
      },
      { forceMock: true },
    );

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Bilal Tariq' }, wa_id: '923005556677' }],
                messages: [
                  {
                    from: '923005556677',
                    id: wamid,
                    timestamp: '1724800000',
                    type: 'text',
                    text: { body: 'Please send catalog.' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Ingest and process
    await POST(createSignedWebhookRequest(JSON.stringify(payload)));
    const event = await prisma.webhookEvent.findFirst({ where: { providerEventId: wamid } });
    await whatsappWebhookHandler({ webhookEventId: event!.id }, dummyJobContext);

    // Inbox List Query: verify unread count is 1 before opening thread
    const inboxPageBefore = await listConversations(ws.context, {});
    expect(inboxPageBefore.conversations).toHaveLength(1);
    const convSummary = inboxPageBefore.conversations[0]!;
    expect(convSummary.unreadCount).toBe(1);
    expect(convSummary.messageCount).toBe(1);
    expect(convSummary.contact.phoneE164).toBe(customerPhone);
    expect(convSummary.contact.name).toBe('Bilal Tariq');

    // Open Message Thread (read path)
    const thread = await listMessages(ws.context, { conversationId: convSummary.id });
    expect(thread.rows).toHaveLength(1);
    expect(thread.rows[0]?.body).toBe('Please send catalog.');

    // Verify unreadCount cleared automatically upon thread read
    const convAfterRead = await getConversation(ws.context, convSummary.id);
    expect(convAfterRead.unreadCount).toBe(0);
    expect(convAfterRead.messageCount).toBe(1);

    // Cross-tenant verification: Workspace B cannot see this conversation
    const wsB = await createWorkspaceFixture({ name: 'Competitor Store' });
    const inboxPageB = await listConversations(wsB.context, {});
    expect(inboxPageB.conversations).toHaveLength(0);
    await expect(getConversation(wsB.context, convSummary.id)).rejects.toThrow(NotFoundError);
  });

  // ── 4. OUTBOUND REPLY & DISPATCH ────────────────────────────────────────────
  it('4. creates single QUEUED message and dispatches via Mock provider updating metrics and SENT status', async () => {
    const ws = await createWorkspaceFixture({ name: 'Fashion Outlet' });
    const phoneNumberId = 'pn_outbound_4001';
    const customerPhone = '+923004445566';
    const inWamid = `wamid.out_test_in_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_outbound_4001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 4445566',
        accessToken: 'EAAG_outbound_token',
      },
      { forceMock: true },
    );

    // Setup inbound conversation
    const inPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Hamza Sheikh' }, wa_id: '923004445566' }],
                messages: [{ from: '923004445566', id: inWamid, timestamp: '1724800000', type: 'text', text: { body: 'Price please' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(inPayload)));
    const inEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: inWamid } });
    await whatsappWebhookHandler({ webhookEventId: inEvent!.id }, dummyJobContext);

    const conv = (await listConversations(ws.context, {})).conversations[0]!;

    // Step 1: Agent writes outbound reply
    const queuedMessage = await sendMessage(ws.context, {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      body: 'The price is Rs. 2,999 with free nationwide delivery.',
    });

    expect(queuedMessage.status).toBe('QUEUED');
    expect(queuedMessage.providerMessageId).toBeNull();

    // Verify thread length is exactly 2
    let thread = await listMessages(ws.context, { conversationId: conv.id });
    expect(thread.rows).toHaveLength(2);

    // Step 2: Dispatch outbound message
    const dispatched = await dispatchOutboundMessage(ws.context, queuedMessage.id);

    expect(dispatched.id).toBe(queuedMessage.id);
    expect(dispatched.status).toBe('SENT');
    expect(dispatched.providerMessageId).toBeDefined();
    expect(dispatched.providerMessageId).toMatch(/^wamid\.mock_/);
    expect(dispatched.sentAt).not.toBeNull();

    // Verify no duplicate message row created
    thread = await listMessages(ws.context, { conversationId: conv.id });
    expect(thread.rows).toHaveLength(2);

    // Verify conversation metrics
    const updatedConv = await getConversation(ws.context, conv.id);
    expect(updatedConv.messageCount).toBe(2);
    expect(updatedConv.lastOutboundAt).not.toBeNull();
    expect(updatedConv.firstResponseAt).not.toBeNull();

    // Verify mock provider received the exact payload
    const mockProvider = getMockWhatsAppProvider();
    expect(mockProvider.getSentMessages()).toHaveLength(1);
    expect(mockProvider.getLastSent()?.toPhone).toBe(customerPhone);
  });

  // ── 5. STATUS RECEIPTS (DELIVERED → READ) ───────────────────────────────────
  it('5. processes DELIVERED and READ receipts via signed HTTP webhooks updating timestamps', async () => {
    const ws = await createWorkspaceFixture();
    const phoneNumberId = 'pn_status_5001';
    const inWamid = `wamid.status_in_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_status_5001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 3332211',
        accessToken: 'EAAG_status_token',
      },
      { forceMock: true },
    );

    // Inbound setup
    const inPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Customer' }, wa_id: '923003332211' }],
                messages: [{ from: '923003332211', id: inWamid, timestamp: '1724800000', type: 'text', text: { body: 'Hi' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(inPayload)));
    const inEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: inWamid } });
    await whatsappWebhookHandler({ webhookEventId: inEvent!.id }, dummyJobContext);
    const conv = (await listConversations(ws.context, {})).conversations[0]!;

    // Outbound send
    const queued = await sendMessage(ws.context, {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      body: 'Hello! How can we assist you today?',
    });
    const dispatched = await dispatchOutboundMessage(ws.context, queued.id);
    const providerMessageId = dispatched.providerMessageId!;

    // 1. DELIVERED receipt
    const delPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'delivered', timestamp: '1724800100', recipient_id: '923003332211' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(delPayload)));
    const delEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: `${providerMessageId}:delivered` } });
    expect(delEvent).not.toBeNull();
    await whatsappWebhookHandler({ webhookEventId: delEvent!.id }, dummyJobContext);

    let msgInDb = await findMessageById(prisma, ws.workspaceId, dispatched.id);
    expect(msgInDb?.status).toBe('DELIVERED');
    expect(msgInDb?.deliveredAt).not.toBeNull();

    // 2. READ receipt
    const readPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'read', timestamp: '1724800200', recipient_id: '923003332211' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(readPayload)));
    const readEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: `${providerMessageId}:read` } });
    expect(readEvent).not.toBeNull();
    await whatsappWebhookHandler({ webhookEventId: readEvent!.id }, dummyJobContext);

    msgInDb = await findMessageById(prisma, ws.workspaceId, dispatched.id);
    expect(msgInDb?.status).toBe('READ');
    expect(msgInDb?.readAt).not.toBeNull();

    // 3. Duplicate READ receipt: verify idempotent no-op
    await POST(createSignedWebhookRequest(JSON.stringify(readPayload)));
    await whatsappWebhookHandler({ webhookEventId: readEvent!.id }, dummyJobContext);
    msgInDb = await findMessageById(prisma, ws.workspaceId, dispatched.id);
    expect(msgInDb?.status).toBe('READ');
  });

  // ── 6. OUT-OF-ORDER STATUS (READ FIRST, THEN DELIVERED) ─────────────────────
  it('6. preserves monotonic state when READ arrives before DELIVERED and never regresses', async () => {
    const ws = await createWorkspaceFixture();
    const phoneNumberId = 'pn_mono_6001';
    const inWamid = `wamid.mono_in_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_mono_6001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 2221100',
        accessToken: 'EAAG_mono_token',
      },
      { forceMock: true },
    );

    // Inbound
    const inPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Customer' }, wa_id: '923002221100' }],
                messages: [{ from: '923002221100', id: inWamid, timestamp: '1724800000', type: 'text', text: { body: 'Hi' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(inPayload)));
    const inEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: inWamid } });
    await whatsappWebhookHandler({ webhookEventId: inEvent!.id }, dummyJobContext);
    const conv = (await listConversations(ws.context, {})).conversations[0]!;

    // Outbound
    const queued = await sendMessage(ws.context, { conversationId: conv.id, direction: 'OUTBOUND', body: 'Order confirmed!' });
    const dispatched = await dispatchOutboundMessage(ws.context, queued.id);
    const providerMessageId = dispatched.providerMessageId!;

    // 1. READ event arrives FIRST
    const readPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'read', timestamp: '1724800300' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(readPayload)));
    const readEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: `${providerMessageId}:read` } });
    await whatsappWebhookHandler({ webhookEventId: readEvent!.id }, dummyJobContext);

    let msg = await findMessageById(prisma, ws.workspaceId, dispatched.id);
    expect(msg?.status).toBe('READ');
    expect(msg?.readAt).not.toBeNull();

    // 2. DELIVERED event arrives SECOND (out-of-order)
    const delPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'delivered', timestamp: '1724800250' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(delPayload)));
    const delEvent = await prisma.webhookEvent.findFirst({ where: { providerEventId: `${providerMessageId}:delivered` } });
    await whatsappWebhookHandler({ webhookEventId: delEvent!.id }, dummyJobContext);

    // Final assertion: Status remains READ, monotonic rank guard prevents status regression
    msg = await findMessageById(prisma, ws.workspaceId, dispatched.id);
    expect(msg?.status).toBe('READ');
    expect(msg?.readAt).not.toBeNull();
  });

  // ── 7. DUPLICATE WEBHOOK IDEMPOTENCY ────────────────────────────────────────
  it('7. handles duplicate webhook delivery idempotently without creating duplicate database rows', async () => {
    const ws = await createWorkspaceFixture();
    const phoneNumberId = 'pn_dupe_7001';
    const wamid = `wamid.dupe_test_${randomUUID().replace(/-/g, '')}`;

    await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_dupe_7001',
        phoneNumberId,
        displayPhoneNumber: '+92 300 1110099',
        accessToken: 'EAAG_dupe_token',
      },
      { forceMock: true },
    );

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10987654321',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Duplicate Tester' }, wa_id: '923001110099' }],
                messages: [{ from: '923001110099', id: wamid, timestamp: '1724800000', type: 'text', text: { body: 'Delivery 1' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // First delivery
    const res1 = await POST(createSignedWebhookRequest(JSON.stringify(payload)));
    expect(res1.status).toBe(200);

    // Second replayed delivery
    const res2 = await POST(createSignedWebhookRequest(JSON.stringify(payload)));
    expect(res2.status).toBe(200);

    // Exactly 1 WebhookEvent and 1 Job exist
    const events = await prisma.webhookEvent.findMany({ where: { providerEventId: wamid } });
    expect(events).toHaveLength(1);

    const jobs = await prisma.job.findMany({ where: { dedupeKey: `whatsapp.process_webhook:${events[0]!.id}` } });
    expect(jobs).toHaveLength(1);

    // Execute job handler twice (simulating worker redelivery)
    await whatsappWebhookHandler({ webhookEventId: events[0]!.id }, dummyJobContext);
    await whatsappWebhookHandler({ webhookEventId: events[0]!.id }, dummyJobContext);

    // Verify exactly 1 Contact, 1 Conversation, and 1 Message in DB
    const contacts = await prisma.contact.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(contacts).toHaveLength(1);

    const conversations = await prisma.conversation.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(conversations).toHaveLength(1);

    const messages = await prisma.message.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(messages).toHaveLength(1);
  });

  // ── 8. MULTI-TENANT ROUTING & ISOLATION ─────────────────────────────────────
  it('8. routes distinct phone numbers to separate workspaces and isolates data completely', async () => {
    const wsA = await createWorkspaceFixture({ name: 'Brand A' });
    const wsB = await createWorkspaceFixture({ name: 'Brand B' });

    const phoneIdA = 'pn_tenant_a_8001';
    const phoneIdB = 'pn_tenant_b_8002';

    await connectWhatsAppAccount(
      wsA.context,
      {
        wabaId: 'waba_tenant_a',
        phoneNumberId: phoneIdA,
        displayPhoneNumber: '+92 300 1111111',
        accessToken: 'EAAG_token_a',
      },
      { forceMock: true },
    );

    await connectWhatsAppAccount(
      wsB.context,
      {
        wabaId: 'waba_tenant_b',
        phoneNumberId: phoneIdB,
        displayPhoneNumber: '+92 300 2222222',
        accessToken: 'EAAG_token_b',
      },
      { forceMock: true },
    );

    const wamidA = `wamid.multi_a_${randomUUID().replace(/-/g, '')}`;
    const wamidB = `wamid.multi_b_${randomUUID().replace(/-/g, '')}`;

    // Webhook for Workspace A
    const payloadA = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1001',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneIdA },
                contacts: [{ profile: { name: 'Customer A' }, wa_id: '923001110001' }],
                messages: [{ from: '923001110001', id: wamidA, timestamp: '1724800000', type: 'text', text: { body: 'For Brand A' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(payloadA)));
    const eventA = await prisma.webhookEvent.findFirst({ where: { providerEventId: wamidA } });
    await whatsappWebhookHandler({ webhookEventId: eventA!.id }, dummyJobContext);

    // Webhook for Workspace B
    const payloadB = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1002',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneIdB },
                contacts: [{ profile: { name: 'Customer B' }, wa_id: '923002220002' }],
                messages: [{ from: '923002220002', id: wamidB, timestamp: '1724800000', type: 'text', text: { body: 'For Brand B' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(payloadB)));
    const eventB = await prisma.webhookEvent.findFirst({ where: { providerEventId: wamidB } });
    await whatsappWebhookHandler({ webhookEventId: eventB!.id }, dummyJobContext);

    // Assert Workspace A records
    const convsA = await listConversations(wsA.context, {});
    expect(convsA.conversations).toHaveLength(1);
    expect(convsA.conversations[0]?.contact.name).toBe('Customer A');

    // Assert Workspace B records
    const convsB = await listConversations(wsB.context, {});
    expect(convsB.conversations).toHaveLength(1);
    expect(convsB.conversations[0]?.contact.name).toBe('Customer B');

    // Cross-tenant access denials
    await expect(getConversation(wsA.context, convsB.conversations[0]!.id)).rejects.toThrow(NotFoundError);
    await expect(getConversation(wsB.context, convsA.conversations[0]!.id)).rejects.toThrow(NotFoundError);
    await expect(listMessages(wsA.context, { conversationId: convsB.conversations[0]!.id })).rejects.toThrow(NotFoundError);
  });

  // ── 9. INVALID / FORGED SIGNATURE ───────────────────────────────────────────
  it('9. rejects unsigned, forged, and malformed webhook requests with 401 and zero database side effects', async () => {
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    // 1. Missing signature header
    const reqNoSig = new Request('http://localhost:3000/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    const resNoSig = await POST(reqNoSig);
    expect(resNoSig.status).toBe(401);

    // 2. Forged signature (signed with attacker secret)
    const reqForged = createSignedWebhookRequest(rawBody, 'wrong-attacker-secret-key-999');
    const resForged = await POST(reqForged);
    expect(resForged.status).toBe(401);

    // 3. Malformed signature header (no sha256= prefix)
    const reqMalformed = new Request('http://localhost:3000/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'unprefixed-hex-value-1234567890abcdef',
      },
      body: rawBody,
    });
    const resMalformed = await POST(reqMalformed);
    expect(resMalformed.status).toBe(401);

    // Assert zero side effects
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  // ── 10. UNKNOWN PHONE NUMBER RESOLUTION ──────────────────────────────────────
  it('10. acknowledges valid webhook for unknown phone number with 200 and marks event IGNORED without creating domain rows', async () => {
    const unknownPhoneId = 'pn_unknown_999999';
    const wamid = `wamid.unknown_${randomUUID().replace(/-/g, '')}`;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '999',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: unknownPhoneId },
                messages: [{ from: '923000000000', id: wamid, timestamp: '1724800000', type: 'text', text: { body: 'Unknown test' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await POST(createSignedWebhookRequest(JSON.stringify(payload)));
    expect(res.status).toBe(200);

    const event = await prisma.webhookEvent.findFirst({ where: { providerEventId: wamid } });
    expect(event).not.toBeNull();
    expect(event?.status).toBe('RECEIVED');
    expect(event?.workspaceId).toBeNull();

    // Execute job
    await whatsappWebhookHandler({ webhookEventId: event!.id }, dummyJobContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event!.id } });
    expect(updatedEvent?.status).toBe('IGNORED');
    expect(updatedEvent?.error).toContain('Unknown phone_number_id');

    // Assert zero domain records created
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  // ── 11. PROVIDER AUTH FAILURE & CREDENTIAL REDACTION ────────────────────────
  it('11. marks message FAILED, account ERROR, and redacts access token when Meta returns 401', async () => {
    const ws = await createWorkspaceFixture();
    const secretToken = 'EAAG_expired_secret_auth_fail_12345';
    const phoneNumberId = 'pn_auth_fail_1101';

    const account = await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_auth_fail_1101',
        phoneNumberId,
        displayPhoneNumber: '+92 300 9988776',
        accessToken: secretToken,
      },
      { forceMock: true },
    );

    const contact = await prisma.contact.create({
      data: { workspaceId: ws.workspaceId, phoneE164: '+923009988776', name: 'Test User' },
    });
    const conv = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
        phoneNumberId: account.phoneNumbers[0]!.id,
      },
    });

    const msg = await sendMessage(ws.context, {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      body: 'Will fail on Meta auth',
    });

    // Mock fetch returning Meta 401 with token reflection
    const mockFetch: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: `Error validating access token: Session expired for token ${secretToken}`,
            type: 'OAuthException',
            code: 190,
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await expect(
      dispatchOutboundMessage(ws.context, msg.id, {
        providerOptions: { forceMeta: true, fetchFn: mockFetch },
      }),
    ).rejects.toThrow(ProviderError);

    // Assert Message state is FAILED with sanitized error
    const failedMsg = await findMessageById(prisma, ws.workspaceId, msg.id);
    expect(failedMsg?.status).toBe('FAILED');
    expect(failedMsg?.errorCode).toBe('PROVIDER_ERROR');
    expect(failedMsg?.errorMessage).toContain('WhatsApp authentication failed');
    expect(failedMsg?.errorMessage).not.toContain(secretToken);

    // Assert Account state is ERROR with sanitized error
    const failedAcc = await findAccountById(prisma, ws.workspaceId, account.id);
    expect(failedAcc?.status).toBe('ERROR');
    expect(failedAcc?.lastErrorAt).toBeInstanceOf(Date);
    expect(failedAcc?.lastErrorMessage).toContain('[REDACTED_ACCESS_TOKEN]');
    expect(failedAcc?.lastErrorMessage).not.toContain(secretToken);
  });

  // ── 12. ACCOUNT DISCONNECT → PREVENTS STALE DISPATCH ─────────────────────────
  it('12. disconnects account, wipes stored encrypted token, ignores inbound webhooks, and rejects outbound dispatch safely', async () => {
    const ws = await createWorkspaceFixture();
    const phoneNumberId = 'pn_disc_1201';

    const account = await connectWhatsAppAccount(
      ws.context,
      {
        wabaId: 'waba_disc_1201',
        phoneNumberId,
        displayPhoneNumber: '+92 300 8877665',
        accessToken: 'EAAG_token_to_disconnect',
      },
      { forceMock: true },
    );

    const contact = await prisma.contact.create({
      data: { workspaceId: ws.workspaceId, phoneE164: '+923008877665', name: 'Disconnect Customer' },
    });
    const conv = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
        phoneNumberId: account.phoneNumbers[0]!.id,
      },
    });

    // Step 1: Disconnect Account
    await disconnectWhatsAppAccount(ws.context, account.id);

    // Assert token wiped in database
    const dbAccount = await findAccountById(prisma, ws.workspaceId, account.id);
    expect(dbAccount?.status).toBe('DISCONNECTED');
    expect(dbAccount?.accessTokenEncrypted).toBeNull();

    const dbPhone = await findPhoneNumberById(prisma, ws.workspaceId, account.phoneNumbers[0]!.id);
    expect(dbPhone?.status).toBe('DISCONNECTED');

    // Step 2: Inbound webhook to disconnected number is marked IGNORED
    const inWamid = `wamid.disc_in_${randomUUID().replace(/-/g, '')}`;
    const inPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1201',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                messages: [{ from: '923008877665', id: inWamid, timestamp: '1724800000', type: 'text', text: { body: 'Should be ignored' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    await POST(createSignedWebhookRequest(JSON.stringify(inPayload)));
    const event = await prisma.webhookEvent.findFirst({ where: { providerEventId: inWamid } });
    await whatsappWebhookHandler({ webhookEventId: event!.id }, dummyJobContext);

    const updatedEvent = await prisma.webhookEvent.findUnique({ where: { id: event!.id } });
    expect(updatedEvent?.status).toBe('IGNORED');
    expect(updatedEvent?.error).toContain('Channel or account not connected');

    // Step 3: Outbound dispatch cannot use stale credentials and throws NotConfiguredError
    const queuedMsg = await sendMessage(ws.context, {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      body: 'Attempt to send without credentials',
    });

    await expect(
      dispatchOutboundMessage(ws.context, queuedMsg.id, {
        providerOptions: { forceMeta: true },
      }),
    ).rejects.toThrow(NotConfiguredError);
  });
});
