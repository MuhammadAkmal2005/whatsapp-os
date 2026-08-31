import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';
import { verifyHmacSha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { consume } from '@/server/ratelimit/limiter';
import { clientIpFrom } from '@/server/ratelimit/window';
import { processBillingWebhook, type BillingEvent } from '@/server/services/billing/billing-webhook.service';

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limiting
    const ip = clientIpFrom(req.headers);
    const rateLimitDecision = await consume('webhook', ip ? `ip:${ip}` : 'anonymous');
    if (!rateLimitDecision.allowed) {
      logger.warn('billing.webhook.rate_limited', { ip });
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      logger.warn('billing.webhook.missing_signature');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    if (env.PAYMENT_PROVIDER === 'stripe') {
      // In a real Stripe integration, we'd use stripe.webhooks.constructEvent
      return NextResponse.json({ error: 'Stripe is not configured in this unit.' }, { status: 501 });
    }

    // Mock provider signature verification (uses PAYMENT_WEBHOOK_SECRET or fallback)
    const secret = env.PAYMENT_WEBHOOK_SECRET || 'test_secret';
    
    // Check if the signature is valid
    if (!verifyHmacSha256(secret, rawBody, signature)) {
      logger.warn('billing.webhook.invalid_signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.warn('billing.webhook.malformed_json');
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }

    // Basic structural validation
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('type' in payload) ||
      !('data' in payload) ||
      typeof (payload as Record<string, unknown>).data !== 'object' ||
      !(payload as Record<string, unknown>).data ||
      !('workspaceId' in ((payload as Record<string, unknown>).data as Record<string, unknown>))
    ) {
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    // Hand off to the idempotent processor
    const event = payload as BillingEvent;
    await processBillingWebhook(event);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    logger.error('billing.webhook.processing_failed', { error });
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
