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

      // 1. Meta looked at the request and refused it, so FAILED is a claim we can make.
      //    The stored sentence is ours, not Meta's: the row is read by a shop owner, and
      //    a token cannot leak from a sentence that never carried one.
      const failedMsg = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(failedMsg).not.toBeNull();
      expect(failedMsg?.status).toBe('FAILED');
      expect(failedMsg?.errorCode).toBe('META_CREDENTIALS_REJECTED');
      expect(failedMsg?.errorMessage).toContain('Reconnect it in Settings');
      expect(failedMsg?.errorMessage).not.toContain('EAAB_expired_secret_token_123');
      // A credential rejection is never retried: a second identical request earns a
      // second identical refusal.
      expect(failedMsg?.deliveryUncertainAt).toBeNull();

      // 2. Verify WhatsAppAccount status was automatically updated to ERROR
      const failedAcc = await findAccountById(prisma, ws.workspaceId, waFixture.accountId);
      expect(failedAcc).not.toBeNull();
      expect(failedAcc?.status).toBe('ERROR');
      expect(failedAcc?.lastErrorAt).toBeInstanceOf(Date);
      expect(failedAcc?.lastErrorMessage).toContain('Reconnect it in Settings');
      expect(failedAcc?.lastErrorMessage).not.toContain('EAAB_expired_secret_token_123');
    });

    it('records a timed-out send as uncertain and never sends it a second time', async () => {
      // Phase 21's whole point. Meta's /messages endpoint has no idempotency key, so a
      // retry of a send whose answer was lost is the one action guaranteed to be wrong if
      // the first attempt arrived.
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_timeout',
      });

      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Aap ka order kal deliver ho jayega.',
      });

      const timingOutFetch = vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      }) as unknown as typeof fetch;

      await expect(
        dispatchOutboundMessage(ws.context, message.id, {
          providerOptions: { forceMeta: true, fetchFn: timingOutFetch },
        }),
      ).rejects.toThrow(ProviderError);

      const uncertain = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(uncertain?.deliveryUncertainAt).toBeInstanceOf(Date);
      expect(uncertain?.errorCode).toBe('TRANSPORT_ABORT_ERR');
      // Not FAILED — that would assert the customer did not receive it — and not SENT,
      // which would assert they did.
      expect(uncertain?.status).toBe('SENDING');
      expect(uncertain?.providerMessageId).toBeNull();
      expect(timingOutFetch).toHaveBeenCalledTimes(1);

      // The retry the queue will attempt. A provider that would answer successfully is
      // supplied on purpose: if the gate were absent, this call would send the duplicate.
      const wouldSucceedFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              messaging_product: 'whatsapp',
              messages: [{ id: 'wamid.duplicate_that_must_not_happen' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;

      const retried = await dispatchOutboundMessage(ws.context, message.id, {
        providerOptions: { forceMeta: true, fetchFn: wouldSucceedFetch },
      });

      expect(wouldSucceedFetch).not.toHaveBeenCalled();
      expect(retried.providerMessageId).toBeNull();
      expect(retried.deliveryUncertainAt).toBeInstanceOf(Date);

      // A channel-level flag would be wrong here: we have no evidence the credentials
      // are bad, only that one exchange did not complete.
      const account = await findAccountById(prisma, ws.workspaceId, waFixture.accountId);
      expect(account?.status).toBe('CONNECTED');
    });

    it('records a Meta 5xx as uncertain rather than as a failed send', async () => {
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_5xx',
      });

      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Thank you for shopping with us.',
      });

      const failingFetch = vi.fn(
        async () => new Response('Internal Server Error', { status: 503 }),
      ) as unknown as typeof fetch;

      await expect(
        dispatchOutboundMessage(ws.context, message.id, {
          providerOptions: { forceMeta: true, fetchFn: failingFetch },
        }),
      ).rejects.toThrow(ProviderError);

      const uncertain = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(uncertain?.deliveryUncertainAt).toBeInstanceOf(Date);
      expect(uncertain?.errorCode).toBe('META_HTTP_503');
      expect(uncertain?.status).toBe('SENDING');
    });

    it('marks a rejected recipient FAILED without flagging the whole connection', async () => {
      // A per-message refusal must not train the owner to ignore the connection banner.
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_bad_recipient',
      });

      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Order confirmed.',
      });

      const rejectingFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Recipient phone number not in allowed list',
                type: 'OAuthException',
                code: 131_030,
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;

      await expect(
        dispatchOutboundMessage(ws.context, message.id, {
          providerOptions: { forceMeta: true, fetchFn: rejectingFetch },
        }),
      ).rejects.toThrow();

      const failed = await findMessageById(prisma, ws.workspaceId, message.id);
      expect(failed?.status).toBe('FAILED');
      expect(failed?.deliveryUncertainAt).toBeNull();

      const account = await findAccountById(prisma, ws.workspaceId, waFixture.accountId);
      expect(account?.status).toBe('CONNECTED');
      expect(account?.lastErrorMessage).toBeNull();
    });

    it('records the outbound success that connection health reads', async () => {
      // `lastOutboundSuccessAt` is the half of health Meta cannot tell us: a token that
      // just sent a message works, whatever a status column claims.
      const ws = await createWorkspaceFixture();
      const waFixture = await createWhatsAppAccountFixture(ws.workspaceId, {
        phoneNumberId: 'meta_phone_health',
      });

      const contact = await createContactFixture(ws.workspaceId);
      const conv = await createConversation(ws.context, {
        contactId: contact.id,
        phoneNumberId: waFixture.phoneRecordId,
      });

      const message = await sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'Your parcel is on its way.',
      });

      const okFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              messaging_product: 'whatsapp',
              messages: [{ id: 'wamid.health_probe_1' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;

      await dispatchOutboundMessage(ws.context, message.id, {
        providerOptions: { forceMeta: true, fetchFn: okFetch },
      });

      const account = await findAccountById(prisma, ws.workspaceId, waFixture.accountId);
      expect(account?.lastOutboundSuccessAt).toBeInstanceOf(Date);

      const phone = await findPhoneNumberById(prisma, ws.workspaceId, waFixture.phoneRecordId);
      expect(phone?.lastOutboundAt).toBeInstanceOf(Date);
    });
  });
});
