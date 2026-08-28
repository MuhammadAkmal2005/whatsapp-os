import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/webhooks/whatsapp/route';
import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { signWebhookBody } from '@/services/whatsapp/signature';
import { resetDatabase } from '../fixtures';

const APP_SECRET = env.META_APP_SECRET ?? 'test-app-secret-12345';
const VERIFY_TOKEN = env.WHATSAPP_VERIFY_TOKEN ?? 'test-verify-token-12345';

function createSignedRequest(body: string, secret = APP_SECRET, headers: Record<string, string> = {}): Request {
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

describe('Phase 4 Unit 2: Meta Webhook Route', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('GET — Subscription Handshake', () => {
    it('returns challenge with 200 status when token is valid', async () => {
      const url = `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=11223344`;
      const req = new Request(url, { method: 'GET' });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('11223344');
    });

    it('returns 403 Forbidden when token is invalid', async () => {
      const url = `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=11223344`;
      const req = new Request(url, { method: 'GET' });

      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden when hub.mode is not subscribe', async () => {
      const url = `http://localhost:3000/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=11223344`;
      const req = new Request(url, { method: 'GET' });

      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  describe('POST — Signature Verification & Raw Body Handling', () => {
    it('rejects a request with missing X-Hub-Signature-256 with 401', async () => {
      const body = JSON.stringify({ test: 'data' });
      const req = new Request('http://localhost:3000/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      // Verify no DB rows created
      const count = await prisma.webhookEvent.count();
      expect(count).toBe(0);
    });

    it('rejects a request with malformed signature header with 401', async () => {
      const body = JSON.stringify({ test: 'data' });
      const req = new Request('http://localhost:3000/api/webhooks/whatsapp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'malformed-signature-without-prefix',
        },
        body,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('rejects a forged signature with 401', async () => {
      const body = JSON.stringify({ test: 'data' });
      const req = createSignedRequest(body, 'wrong-attacker-secret');

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('preserves and accepts Urdu/Unicode raw body exact bytes', async () => {
      const wamid = `wamid.urdu_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [
                    {
                      from: '923001234567',
                      id: wamid,
                      type: 'text',
                      text: { body: 'کالا کرتا ایکس ایل دستیاب ہے؟ بھائی قیمت کیا ہے؟' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const req = createSignedRequest(rawBody);

      const res = await POST(req);
      expect(res.status).toBe(200);

      const event = await prisma.webhookEvent.findFirst({
        where: { providerEventId: wamid },
      });
      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('message');
      expect(event?.phoneNumberId).toBe('106540352242922');
    });

    it('returns 400 Bad Request when JSON is malformed despite matching signature', async () => {
      const malformedJson = '{"not_closed_json: true';
      const req = createSignedRequest(malformedJson);

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('POST — Persistence, Enqueue & Idempotency', () => {
    it('persists a single valid message event and enqueues a background job atomically', async () => {
      const wamid = `wamid.test_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  contacts: [{ profile: { name: 'Ali Ahmed' }, wa_id: '923001234567' }],
                  messages: [
                    {
                      from: '923001234567',
                      id: wamid,
                      type: 'text',
                      text: { body: 'Order status check' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req = createSignedRequest(JSON.stringify(payload));
      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify WebhookEvent
      const event = await prisma.webhookEvent.findFirst({
        where: { providerEventId: wamid },
      });
      expect(event).not.toBeNull();
      expect(event?.provider).toBe('whatsapp');
      expect(event?.eventType).toBe('message');
      expect(event?.workspaceId).toBeNull(); // Tenant resolution is strictly deferred to job handler
      expect(event?.phoneNumberId).toBe('106540352242922');
      expect(event?.status).toBe('RECEIVED');
      expect(event?.signatureValid).toBe(true);

      // Verify Job
      const job = await prisma.job.findFirst({
        where: { dedupeKey: `whatsapp.process_webhook:${event?.id}` },
      });
      expect(job).not.toBeNull();
      expect(job?.type).toBe('whatsapp.process_webhook');
      expect(job?.status).toBe('PENDING');
      expect(job?.maxAttempts).toBe(8);
      expect(job?.priority).toBe(90);

      // Security check: Payload must contain only safe ID, no raw secrets
      expect(job?.payload).toEqual({ webhookEventId: event?.id });
    });

    it('persists multiple logical events from one payload independently', async () => {
      const wamid1 = `wamid.multi1_${randomUUID().replace(/-/g, '')}`;
      const wamid2 = `wamid.multi2_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [
                    { from: '923001', id: wamid1, type: 'text', text: { body: 'msg 1' } },
                    { from: '923002', id: wamid2, type: 'text', text: { body: 'msg 2' } },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req = createSignedRequest(JSON.stringify(payload));
      const res = await POST(req);
      expect(res.status).toBe(200);

      const events = await prisma.webhookEvent.findMany({
        where: { providerEventId: { in: [wamid1, wamid2] } },
      });
      expect(events).toHaveLength(2);

      const jobs = await prisma.job.findMany({
        where: { type: 'whatsapp.process_webhook' },
      });
      expect(jobs).toHaveLength(2);
    });

    it('handles duplicate message delivery idempotently without creating duplicate rows', async () => {
      const wamid = `wamid.dupe_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [{ from: '923001234567', id: wamid, type: 'text', text: { body: 'hello' } }],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req1 = createSignedRequest(JSON.stringify(payload));
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // Send the exact same webhook again (replayed delivery)
      const req2 = createSignedRequest(JSON.stringify(payload));
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);

      const events = await prisma.webhookEvent.findMany({
        where: { providerEventId: wamid },
      });
      expect(events).toHaveLength(1);

      const jobs = await prisma.job.findMany({
        where: { dedupeKey: `whatsapp.process_webhook:${events[0]!.id}` },
      });
      expect(jobs).toHaveLength(1);
    });

    it('persists DELIVERED and READ statuses independently without ID collision', async () => {
      const commonWamid = `wamid.status_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  statuses: [
                    { id: commonWamid, status: 'delivered', timestamp: '1756200001' },
                    { id: commonWamid, status: 'read', timestamp: '1756200005' },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req = createSignedRequest(JSON.stringify(payload));
      const res = await POST(req);
      expect(res.status).toBe(200);

      const deliveredEvent = await prisma.webhookEvent.findFirst({
        where: { providerEventId: `${commonWamid}:delivered` },
      });
      const readEvent = await prisma.webhookEvent.findFirst({
        where: { providerEventId: `${commonWamid}:read` },
      });

      expect(deliveredEvent).not.toBeNull();
      expect(readEvent).not.toBeNull();
      expect(deliveredEvent?.eventType).toBe('status');
      expect(readEvent?.eventType).toBe('status');
    });

    it('handles duplicate status receipts idempotently', async () => {
      const commonWamid = `wamid.status_dupe_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  statuses: [{ id: commonWamid, status: 'delivered', timestamp: '1756200001' }],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req1 = createSignedRequest(JSON.stringify(payload));
      expect((await POST(req1)).status).toBe(200);

      const req2 = createSignedRequest(JSON.stringify(payload));
      expect((await POST(req2)).status).toBe(200);

      const deliveredEvents = await prisma.webhookEvent.findMany({
        where: { providerEventId: `${commonWamid}:delivered` },
      });
      expect(deliveredEvents).toHaveLength(1);
    });

    it('persists unknown phone_number_id with workspaceId = null and enqueues job', async () => {
      const wamid = `wamid.unknown_phone_${randomUUID().replace(/-/g, '')}`;
      const unknownPhoneId = '999999999999999';
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: unknownPhoneId },
                  messages: [{ from: '923001234567', id: wamid, type: 'text', text: { body: 'test' } }],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const req = createSignedRequest(JSON.stringify(payload));
      const res = await POST(req);
      expect(res.status).toBe(200);

      const event = await prisma.webhookEvent.findFirst({
        where: { providerEventId: wamid },
      });
      expect(event).not.toBeNull();
      expect(event?.workspaceId).toBeNull();
      expect(event?.phoneNumberId).toBe(unknownPhoneId);
      expect(event?.status).toBe('RECEIVED');
    });

    it('persists malformed or unsupported event structures as type unknown', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                field: 'unsupported_field',
                value: { unexpected: 'format' },
              },
            ],
          },
        ],
      };

      const req = createSignedRequest(JSON.stringify(payload));
      const res = await POST(req);
      expect(res.status).toBe(200);

      const event = await prisma.webhookEvent.findFirst({
        where: { eventType: 'unknown' },
      });
      expect(event).not.toBeNull();
      expect(event?.status).toBe('RECEIVED');
    });
    it('rolls back WebhookEvent insert if job creation fails in transaction', async () => {
      const wamid = `wamid.rollback_${randomUUID().replace(/-/g, '')}`;
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '102290129340398',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [{ from: '923001234567', id: wamid, type: 'text', text: { body: 'test' } }],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      // Mock insertJob to throw inside transaction
      const jobRepo = await import('@/server/repositories/job.repository');
      const spy = vi.spyOn(jobRepo, 'insertJob').mockRejectedValueOnce(new Error('Simulated queue failure'));

      const req = createSignedRequest(JSON.stringify(payload));
      await expect(POST(req)).rejects.toThrow('Simulated queue failure');

      // Verify WebhookEvent was rolled back and does not exist
      const event = await prisma.webhookEvent.findFirst({
        where: { providerEventId: wamid },
      });
      expect(event).toBeNull();

      spy.mockRestore();
    });
  });

  describe('Rate Limiting', () => {
    it('returns 429 Too Many Requests when rate limit bucket is exhausted', async () => {
      const clientIp = '198.51.100.99';
      // Pre-fill the rate limit bucket for this IP in rate_limit_buckets table
      const resetAt = new Date(Date.now() + 60_000);
      await prisma.rateLimitBucket.create({
        data: {
          key: `webhook:ip:${clientIp}`,
          count: 2000, // limit is 2000 in config/constants.ts
          resetAt,
        },
      });

      const body = JSON.stringify({ test: 'rate-limit' });
      const req = createSignedRequest(body, APP_SECRET, { 'x-forwarded-for': clientIp });

      const res = await POST(req);
      expect(res.status).toBe(429);
    });
  });
});
