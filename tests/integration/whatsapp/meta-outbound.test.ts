import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { encryptSecret } from '@/lib/crypto';
import { NotConfiguredError, NotFoundError, ProviderError } from '@/server/errors';
import {
  findAccountById,
  findDefaultPhoneNumberWithAccount,
  findPhoneNumberById,
} from '@/server/repositories/whatsapp-account.repository';
import {
  findConversationById,
} from '@/server/repositories/conversation.repository';
import { findMessageById } from '@/server/repositories/message.repository';
import { createConversation } from '@/server/services/conversation/conversation.service';
import { sendMessage } from '@/server/services/conversation/message.service';
import { MetaWhatsAppProvider } from '@/server/services/whatsapp/meta-provider';
import { dispatchOutboundMessage } from '@/server/services/whatsapp/outbound.service';
import {
  getMockWhatsAppProvider,
  getWhatsAppProvider,
  resetMockWhatsAppProvider,
} from '@/server/services/whatsapp/provider.factory';
import {
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

async function createWhatsAppAccountFixture(
  workspaceId: string,
  options: {
    wabaId?: string;
    accessToken?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    isDefault?: boolean;
  } = {},
) {
  const wabaId = options.wabaId ?? `waba_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const token = options.accessToken ?? 'EAAB_test_token_live_12345';
  const accessTokenEncrypted = encryptSecret(token, env.AUTH_SECRET);
  const phoneNumberId = options.phoneNumberId ?? `meta_phone_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  const account = await prisma.whatsAppAccount.create({
    data: {
      workspaceId,
      wabaId,
      displayName: 'Main Business Account',
      accessTokenEncrypted,
      status: 'CONNECTED',
    },
  });

  const phone = await prisma.whatsAppPhoneNumber.create({
    data: {
      workspaceId,
      accountId: account.id,
      phoneNumberId,
      displayPhoneNumber: options.displayPhoneNumber ?? '+92 300 1234567',
      status: 'CONNECTED',
      isDefault: options.isDefault ?? true,
    },
  });

  return {
    accountId: account.id,
    phoneRecordId: phone.id,
    phoneNumberId,
    rawToken: token,
  };
}

describe('Phase 4 Unit 1: Meta WhatsApp Provider & Secure Credentials', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockWhatsAppProvider();
  });

  describe('Secure Credential Resolution & Factory (Must-Fix 2 & Fix 3)', () => {
    it('resolves MockWhatsAppProvider when mock mode is active', async () => {
      const provider = await getWhatsAppProvider();
      expect(provider).toBe(getMockWhatsAppProvider());
    });

    it('resolves and decrypts WhatsApp credentials for workspace phone number in Meta mode', async () => {
      const ws = await createWorkspaceFixture();
      const fixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        accessToken: 'EAAB_secret_token_live_9999',
        phoneNumberId: '109876543210',
      });

      // Repository loads phone number and account with post-read workspace check
      const phoneRecord = await findPhoneNumberById(prisma, ws.workspaceId, fixture.phoneRecordId);
      expect(phoneRecord).not.toBeNull();
      expect(phoneRecord?.phoneNumberId).toBe('109876543210');
      expect(phoneRecord?.account.accessTokenEncrypted).not.toBeNull();
      expect(phoneRecord?.account.accessTokenEncrypted).not.toBe('EAAB_secret_token_live_9999');

      // Factory resolves MetaWhatsAppProvider when forced to Meta
      const metaProvider = await getWhatsAppProvider({
        workspaceId: ws.workspaceId,
        phoneRecordId: fixture.phoneRecordId,
        forceMeta: true,
      });
      expect(metaProvider).toBeInstanceOf(MetaWhatsAppProvider);
    });

    it('throws NotConfiguredError when workspace has no database WhatsApp credentials', async () => {
      const ws = await createWorkspaceFixture();

      // Attempt to resolve real Meta provider for a workspace without an account
      await expect(
        getWhatsAppProvider({
          workspaceId: ws.workspaceId,
          forceMeta: true,
        }),
      ).rejects.toThrow(NotConfiguredError);
    });

    it('enforces strict tenant isolation on WhatsApp accounts and phone numbers', async () => {
      const wsA = await createWorkspaceFixture({ name: 'Workspace A' });
      const wsB = await createWorkspaceFixture({ name: 'Workspace B' });

      const fixtureA = await createWhatsAppAccountFixture(wsA.workspaceId);

      // Workspace B cannot find Workspace A's phone number by ID
      const inB = await findPhoneNumberById(prisma, wsB.workspaceId, fixtureA.phoneRecordId);
      expect(inB).toBeNull();

      // Workspace B cannot find Workspace A's account by ID
      const accInB = await findAccountById(prisma, wsB.workspaceId, fixtureA.accountId);
      expect(accInB).toBeNull();

      // Factory with Workspace B context cannot use Workspace A's credentials
      await expect(
        getWhatsAppProvider({
          workspaceId: wsB.workspaceId,
          phoneRecordId: fixtureA.phoneRecordId,
          forceMeta: true,
        }),
      ).rejects.toThrow(NotConfiguredError);
    });
  });

  describe('SENDING State Safety & Idempotency (Must-Fix 1)', () => {
    it('returns immediately without re-dispatch if providerMessageId is already set', async () => {
      const ws = await createWorkspaceFixture();
      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, { contactId: contact.id });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Already sent test',
      });

      // Manually simulate a message that completed dispatch (providerMessageId set, status SENDING or SENT)
      await prisma.message.updateMany({
        where: { id: message.id, workspaceId: ws.workspaceId },
        data: {
          status: 'SENDING',
          providerMessageId: 'wamid.already_dispatched_test_123',
        },
      });

      const result = await dispatchOutboundMessage(ws.context, message.id);
      expect(result.providerMessageId).toBe('wamid.already_dispatched_test_123');
    });

    it('safely re-checks database state when message is in SENDING state before dispatching', async () => {
      const ws = await createWorkspaceFixture();
      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, { contactId: contact.id });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Crashed worker test',
      });

      // Set status to SENDING without providerMessageId (simulating crash before send)
      await prisma.message.updateMany({
        where: { id: message.id, workspaceId: ws.workspaceId },
        data: { status: 'SENDING', providerMessageId: null },
      });

      const result = await dispatchOutboundMessage(ws.context, message.id);
      expect(result.status).toBe('SENT');
      expect(result.providerMessageId).toMatch(/^wamid\./);
    });
  });

  describe('Meta Outbound Dispatch Execution & Real Auth Error Path (Fix 5)', () => {
    it('dispatches outbound message using Meta provider and updates status without duplication', async () => {
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_123',
      });

      const contact = await createContactFixture(ws.workspaceId, {
        phoneE164: '+923001234567',
        name: 'Bilal Ahmed',
      });

      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      // Create outbound message
      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Your shipment has departed from our warehouse.',
      });

      expect(message.status).toBe('QUEUED');
      expect(message.providerMessageId).toBeNull();

      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            contacts: [{ input: '923001234567', wa_id: '923001234567' }],
            messages: [{ id: 'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzOEU0NzFD' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      // Dispatch through outbound service with Meta provider seam
      const dispatched = await dispatchOutboundMessage(ws.context, message.id, {
        providerOptions: { forceMeta: true, fetchFn: mockFetch },
      });

      expect(dispatched.id).toBe(message.id);
      expect(dispatched.status).toBe('SENT');
      expect(dispatched.providerMessageId).toBe('wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzOEU0NzFD');
      expect(dispatched.sentAt).not.toBeNull();

      // Verify no duplicate message was created in database
      const finalMessage = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(finalMessage?.id).toBe(message.id);
      expect(finalMessage?.status).toBe('SENT');

      // Verify conversation timestamp was updated
      const updatedConv = await findConversationById(prisma, ws.workspaceId, conv.id);
      expect(updatedConv?.lastMessageAt).toEqual(dispatched.sentAt);
      expect(updatedConv?.lastOutboundAt).toEqual(dispatched.sentAt);
    });

    it('exercises the actual dispatchOutboundMessage path on Meta 401 error and updates account status to ERROR', async () => {
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_auth_fail',
        accessToken: 'EAAB_expired_secret_token_123',
      });

      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Will fail on live auth',
      });

      // Mock fetch returning a 401 OAuthException from Meta Graph API
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Error validating access token: Session has expired for token EAAB_expired_secret_token_123',
              type: 'OAuthException',
              code: 190,
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      // Exercise the actual dispatchOutboundMessage service call
      await expect(
        dispatchOutboundMessage(ws.context, message.id, {
          providerOptions: { forceMeta: true, fetchFn: mockFetch },
        }),
      ).rejects.toThrow(ProviderError);

      // 1. Verify Message record was updated to FAILED with sanitized error message
      const failedMsg = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(failedMsg).not.toBeNull();
      expect(failedMsg?.status).toBe('FAILED');
      expect(failedMsg?.errorCode).toBe('PROVIDER_ERROR');
      expect(failedMsg?.errorMessage).toContain('WhatsApp authentication failed');
      expect(failedMsg?.errorMessage).not.toContain('EAAB_expired_secret_token_123');

      // 2. Verify WhatsAppAccount status was automatically updated to ERROR with sanitized lastErrorMessage
      const failedAcc = await findAccountById(prisma, ws.workspaceId, waFixture.accountId);
      expect(failedAcc).not.toBeNull();
      expect(failedAcc?.status).toBe('ERROR');
      expect(failedAcc?.lastErrorAt).toBeInstanceOf(Date);
      expect(failedAcc?.lastErrorMessage).toContain('WhatsApp authentication failed');
      expect(failedAcc?.lastErrorMessage).not.toContain('EAAB_expired_secret_token_123');
      expect(failedAcc?.lastErrorMessage).toContain('[REDACTED_ACCESS_TOKEN]');
    });
  });
});
