/**
 * Meta WhatsApp Webhook Endpoint.
 *
 * GET: Handles the one-time Meta Webhook verification handshake.
 * POST: Ingests signed WhatsApp webhook payloads, parses logical events,
 *       atomically persists WebhookEvent records alongside background Jobs,
 *       and returns 200 immediately without running domain processing.
 */

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { consume } from '@/server/ratelimit/limiter';
import { clientIpFrom } from '@/server/ratelimit/window';
import {
  extractLogicalEvents,
  persistLogicalEvent,
} from '@/server/services/whatsapp/webhook.parser';
import {
  verifySubscription,
  verifyWebhookSignature,
} from '@/services/whatsapp/signature';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expectedToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!expectedToken) {
    logger.error('whatsapp.webhook.verify_token_missing');
    return new Response('Forbidden', { status: 403 });
  }

  const result = verifySubscription({ mode, token, challenge }, expectedToken);
  if (result.verified) {
    return new Response(result.challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Rate limiting
  const ip = clientIpFrom(request.headers);
  const rateLimitDecision = await consume('webhook', ip ? `ip:${ip}` : 'anonymous');
  if (!rateLimitDecision.allowed) {
    logger.warn('whatsapp.webhook.rate_limited', { ip });
    return new Response('Too Many Requests', { status: 429 });
  }

  // 2. Read raw request body
  const rawBody = await request.text();

  // 3. Signature verification
  const signatureHeader = request.headers.get('x-hub-signature-256');
  const appSecret = env.META_APP_SECRET;
  if (!appSecret) {
    logger.error('whatsapp.webhook.app_secret_missing');
    return new Response('Unauthorized', { status: 401 });
  }

  const sigResult = verifyWebhookSignature(rawBody, signatureHeader, appSecret);
  if (!sigResult.valid) {
    logger.warn('whatsapp.webhook.invalid_signature', { reason: sigResult.reason, ip });
    return new Response('Unauthorized', { status: 401 });
  }

  // 4. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.warn('whatsapp.webhook.malformed_json', { ip });
    return new Response('Bad Request', { status: 400 });
  }

  // 5. Extract logical events
  const events = extractLogicalEvents(payload);

  // 6. Atomically persist each event and enqueue job
  for (const event of events) {
    await persistLogicalEvent(event);
  }

  return new Response('OK', { status: 200 });
}
