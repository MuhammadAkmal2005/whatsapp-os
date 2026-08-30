import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';
import { verifyHmacSha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { processBillingWebhook, type BillingEvent } from '@/server/services/billing/billing-webhook.service';

export async function POST(req: NextRequest) {
  try {
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

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.warn('billing.webhook.malformed_json');
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }

    // Basic structural validation
    if (!payload || !payload.type || !payload.data || !payload.data.workspaceId) {
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
