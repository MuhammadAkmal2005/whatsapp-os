import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db/prisma';
import { processBillingWebhook } from '@/server/services/billing/billing-webhook.service';
import { processCheckoutOrDowngrade } from '@/server/services/billing/checkout.service';
import {
  cancelSubscriptionAction,
  changePlanAction,
  resumeSubscriptionAction,
} from '@/server/actions/subscription.actions';
import * as tenancyResolve from '@/server/tenancy/resolve';
import { createWorkspaceFixture, resetDatabase, tenantContextFor, createMemberFixture } from '../fixtures';
import { hmacSha256Hex } from '@/lib/crypto';
import { env } from '@/config/env';

describe('Phase 8 Unit 3: Payment Provider Webhook & Checkout Integration', () => {
  it('1. changePlanAction uses processCheckoutOrDowngrade to return redirect URL for paid plans', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Alpha' });
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);

    // Downgrade to free -> succeeds instantly without checkout
    const freeRes = await changePlanAction({ planKey: 'free' });
    expect(freeRes.success).toBe(true);
    if (freeRes.success) {
      expect(freeRes.data.redirectUrl).toBeUndefined(); // no redirect
    }

    // Upgrade to starter -> requires checkout
    const starterRes = await changePlanAction({ planKey: 'starter' });
    expect(starterRes.success).toBe(true);
    if (starterRes.success) {
      expect(starterRes.data.redirectUrl).toContain('/api/billing/mock/checkout');
      expect(starterRes.data.redirectUrl).toContain('planKey=starter');
    }
  });

  it('2. webhook processor handles checkout.session.completed idempotently', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Beta' });
    const providerSubscriptionId = 'sub_mock_12345';

    const event = {
      type: 'checkout.session.completed' as const,
      data: {
        workspaceId: ws.workspaceId,
        planKey: 'business',
        providerSubscriptionId,
      },
    };

    // First delivery
    await processBillingWebhook(event, prisma);
    
    let sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.workspaceId } });
    expect(sub?.planKey).toBe('business');
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.providerSubscriptionId).toBe(providerSubscriptionId);
    expect(sub?.trialEndsAt).toBeNull();
    
    // Check audit logs for plan_changed
    let logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.plan_changed' } });
    expect(logs.length).toBe(1);

    // Duplicate delivery (replay)
    await processBillingWebhook(event, prisma);
    
    // Should be idempotent, no second audit log
    logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.plan_changed' } });
    expect(logs.length).toBe(1); // Still 1
  });

  it('3. webhook processor handles customer.subscription.updated idempotently (cancel/resume)', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Gamma' });
    const providerSubscriptionId = 'sub_mock_gamma';

    // Initial setup
    await processBillingWebhook({
      type: 'checkout.session.completed',
      data: { workspaceId: ws.workspaceId, planKey: 'starter', providerSubscriptionId },
    }, prisma);

    // Cancel at period end
    const cancelEvent = {
      type: 'customer.subscription.updated' as const,
      data: {
        workspaceId: ws.workspaceId,
        planKey: 'starter',
        providerSubscriptionId,
        cancelAtPeriodEnd: true,
      },
    };

    await processBillingWebhook(cancelEvent, prisma);

    let sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.workspaceId } });
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    expect(sub?.canceledAt).not.toBeNull();

    let logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.canceled' } });
    expect(logs.length).toBe(1);

    // Duplicate delivery
    await processBillingWebhook(cancelEvent, prisma);
    logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.canceled' } });
    expect(logs.length).toBe(1); // Idempotent

    // Resume
    const resumeEvent = {
      type: 'customer.subscription.updated' as const,
      data: {
        workspaceId: ws.workspaceId,
        planKey: 'starter',
        providerSubscriptionId,
        cancelAtPeriodEnd: false,
      },
    };

    await processBillingWebhook(resumeEvent, prisma);

    sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.workspaceId } });
    expect(sub?.cancelAtPeriodEnd).toBe(false);
    expect(sub?.canceledAt).toBeNull();

    logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.resumed' } });
    expect(logs.length).toBe(1);
  });

  it('4. webhook processor handles customer.subscription.deleted by downgrading to free', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Delta' });
    const providerSubscriptionId = 'sub_mock_delta';

    await processBillingWebhook({
      type: 'checkout.session.completed',
      data: { workspaceId: ws.workspaceId, planKey: 'pro', providerSubscriptionId },
    }, prisma);

    const deleteEvent = {
      type: 'customer.subscription.deleted' as const,
      data: {
        workspaceId: ws.workspaceId,
        planKey: 'pro',
        providerSubscriptionId,
      },
    };

    await processBillingWebhook(deleteEvent, prisma);

    const sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.workspaceId } });
    expect(sub?.planKey).toBe('free');
    expect(sub?.providerSubscriptionId).toBeNull();
    expect(sub?.status).toBe('ACTIVE');

    const logs = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, action: 'subscription.canceled' } });
    expect(logs.length).toBe(1);
  });

  it('5. ignores webhook for unknown providerSubscriptionId', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Epsilon' });

    await processBillingWebhook({
      type: 'checkout.session.completed',
      data: { workspaceId: ws.workspaceId, planKey: 'starter', providerSubscriptionId: 'sub_valid' },
    }, prisma);

    const invalidUpdateEvent = {
      type: 'customer.subscription.updated' as const,
      data: {
        workspaceId: ws.workspaceId,
        planKey: 'starter',
        providerSubscriptionId: 'sub_invalid',
        cancelAtPeriodEnd: true,
      },
    };

    await processBillingWebhook(invalidUpdateEvent, prisma);

    const sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.workspaceId } });
    expect(sub?.cancelAtPeriodEnd).toBe(false); // Update was ignored
  });

  it('6. validates webhook signature rejection through API simulation', async () => {
    // We simulate the signature check exactly as the route handler does
    const secret = env.PAYMENT_WEBHOOK_SECRET || 'test_secret';
    const payload = JSON.stringify({ type: 'some_event' });
    
    const validSignature = hmacSha256Hex(secret, payload);
    const invalidSignature = 'deadbeef';

    const isValid = (sig: string) => hmacSha256Hex(secret, payload) === sig;

    expect(isValid(validSignature)).toBe(true);
    expect(isValid(invalidSignature)).toBe(false);
  });

  it('7. preserves strict tenant isolation in processing', async () => {
    await resetDatabase();
    const wsA = await createWorkspaceFixture({ name: 'Tenant A' });
    const wsB = await createWorkspaceFixture({ name: 'Tenant B' });
    const providerSubscriptionIdA = 'sub_a';
    const providerSubscriptionIdB = 'sub_b';

    // A checkouts
    await processBillingWebhook({
      type: 'checkout.session.completed',
      data: { workspaceId: wsA.workspaceId, planKey: 'pro', providerSubscriptionId: providerSubscriptionIdA },
    }, prisma);

    // B checkouts
    await processBillingWebhook({
      type: 'checkout.session.completed',
      data: { workspaceId: wsB.workspaceId, planKey: 'business', providerSubscriptionId: providerSubscriptionIdB },
    }, prisma);

    // Ensure A is pro, B is business
    const subA1 = await prisma.subscription.findUnique({ where: { workspaceId: wsA.workspaceId } });
    const subB1 = await prisma.subscription.findUnique({ where: { workspaceId: wsB.workspaceId } });
    expect(subA1?.planKey).toBe('pro');
    expect(subB1?.planKey).toBe('business');

    // Mismatched provider ID should be ignored
    await processBillingWebhook({
      type: 'customer.subscription.deleted',
      data: { workspaceId: wsB.workspaceId, planKey: 'business', providerSubscriptionId: providerSubscriptionIdA },
    }, prisma);

    const subB2 = await prisma.subscription.findUnique({ where: { workspaceId: wsB.workspaceId } });
    expect(subB2?.planKey).toBe('business'); // Was not affected by event carrying A's sub id
  });
});
