/**
 * Meta WhatsApp Webhook Endpoint.
 *
 * GET: answers Meta's verification challenge. This runs whenever the callback URL is
 *      (re)configured in the App Dashboard — it is not the subscription itself. A WABA is
 *      only subscribed by `POST /<WABA_ID>/subscribed_apps`, which the onboarding service
 *      does per business.
 *
 * POST: verifies the signature over the raw body, records each logical event, enqueues the
 *       work, and returns 200. Domain processing never runs inline: Meta expects a fast
 *       acknowledgement and retries anything slow, and a retry of work already half-done is
 *       how duplicate customer replies happen.
 *
 * The order of the checks in POST is deliberate and is the security argument for this file:
 * nothing is trusted, and nothing is *throttled*, before the HMAC is verified. A valid
 * signature is proof the delivery came from Meta, because only Meta and this deployment hold
 * the app secret. Rate-limiting valid deliveries by IP would drop real customer messages —
 * Meta sends every tenant's traffic from a small pool of addresses, so one busy shop would
 * consume the allowance of every other shop, and repeated non-2xx responses make Meta
 * disable the subscription. The limiter therefore sits on the *rejected* path only.
 */

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { consume } from '@/server/ratelimit/limiter';
import { clientIpFrom } from '@/server/ratelimit/window';
import { emitWebhookReceived, emitWebhookRejected } from '@/server/telemetry/meta-events';
import {
  extractLogicalEvents,
  persistLogicalEvent,
} from '@/server/services/whatsapp/webhook.parser';
import {
  verifySubscription,
  verifyWebhookSignature,
} from '@/services/whatsapp/signature';

/**
 * Largest delivery we will hash.
 *
 * Meta's webhook payloads are a few kilobytes; the biggest realistic one is a batch of
 * status updates. The cap bounds the HMAC work an unauthenticated caller can ask for
 * before the signature has been checked, which is the one piece of work that has to
 * happen before we know who is calling.
 */
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

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

const REJECTION_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  413: 'Payload Too Large',
};

/**
 * Records a rejection and decides its status code.
 *
 * Returns 429 once the source has exhausted its rejected-delivery allowance, and the
 * caller's own code otherwise. A limiter failure is not allowed to change the outcome: the
 * request is being rejected either way, and the limiter is only bounding repetition.
 */
async function reject(code: number, reason: string, ip: string | null): Promise<Response> {
  emitWebhookRejected({ reason });
  logger.warn('whatsapp.webhook.rejected', { reason, ip });

  try {
    const decision = await consume('webhookRejected', ip ? `ip:${ip}` : 'anonymous');
    if (!decision.allowed) {
      return new Response('Too Many Requests', { status: 429 });
    }
  } catch (error) {
    logger.warn('whatsapp.webhook.limiter_unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new Response(REJECTION_TEXT[code] ?? 'Bad Request', { status: code });
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIpFrom(request.headers);

  const appSecret = env.META_APP_SECRET;
  if (!appSecret) {
    // A deployment without the app secret cannot verify anything, so it must not accept
    // anything. Failing closed here is what stops an unconfigured environment from
    // processing forged events.
    logger.error('whatsapp.webhook.app_secret_missing');
    return new Response('Unauthorized', { status: 401 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return reject(413, 'body_too_large', ip);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return reject(413, 'body_too_large', ip);
  }

  const signatureHeader = request.headers.get('x-hub-signature-256');
  const sigResult = verifyWebhookSignature(rawBody, signatureHeader, appSecret);
  if (!sigResult.valid) {
    return reject(401, `invalid_signature:${sigResult.reason}`, ip);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Meta would not send this, so the app secret is almost
    // certainly wrong rather than the payload — but a 400 is still the honest answer, and
    // retrying it would not help either side.
    return reject(400, 'malformed_json', ip);
  }

  const events = extractLogicalEvents(payload);
  emitWebhookReceived({ eventCount: events.length });

  let failed = 0;
  for (const event of events) {
    // Per event, not per batch: `persistLogicalEvent` already treats an id we have seen
    // before as a no-op, so one event failing does not stop the rest from being recorded.
    try {
      await persistLogicalEvent(event);
    } catch (error) {
      failed += 1;
      logger.error('whatsapp.webhook.event_persist_failed', {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed > 0) {
    // Anything that reaches here is a database problem, not a bad payload — duplicates are
    // swallowed upstream. A 500 is what makes Meta re-deliver, and the unique constraint on
    // `(provider, providerEventId)` makes that re-delivery cost nothing for the events that
    // already landed. Returning 200 would silently drop a real customer message.
    logger.error('whatsapp.webhook.batch_partially_failed', { failed, total: events.length });
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
