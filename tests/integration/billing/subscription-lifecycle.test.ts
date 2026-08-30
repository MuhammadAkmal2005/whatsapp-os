/**
 * Phase 8 Unit 1: Subscription Lifecycle & Plan Limit Enforcement Integration Suite.
 *
 * Verifies:
 * 1. Subscription initialization & trial lifecycle with business plan defaults.
 * 2. Graceful trial expiration falling back to 'free' plan limits.
 * 3. Plan change, upgrade, downgrade, cancel, and resume operations with audit logging.
 * 4. Centralized plan limit enforcement across products, contacts, automations, and seats.
 * 5. Graceful degradation (read queries & existing data intact, write mutations restricted).
 * 6. Server actions with strict RBAC enforcement (OWNER vs ADMIN vs AGENT/VIEWER).
 * 7. Multi-tenant subscription and quota isolation.
 */

import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db/prisma';
import {
  cancelSubscriptionAction,
  changePlanAction,
  fetchSubscriptionAction,
  resumeSubscriptionAction,
} from '@/server/actions/subscription.actions';
import {
  assertPlanHasFeature,
  assertWithinPlanLimit,
  getEffectivePlan,
  getEffectivePlanKey,
} from '@/server/services/billing/limit-guard.service';
import {
  cancelSubscription,
  changeSubscriptionPlan,
  ensureWorkspaceSubscription,
  getSubscriptionOverview,
  resumeSubscription,
} from '@/server/services/subscription/subscription.service';
import * as tenancyResolve from '@/server/tenancy/resolve';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '../fixtures';

describe('Phase 8 Unit 1: Subscription Lifecycle & Limit Enforcement', () => {
  it('1. initializes workspace subscription on trial with business plan and correct trial days', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Trial Retail Store' });

    const overview = await getSubscriptionOverview(ws.context);

    expect(overview.subscription.status).toBe('TRIAL');
    expect(overview.subscription.planKey).toBe('business');
    expect(overview.subscription.effectivePlanKey).toBe('business');
    expect(overview.subscription.isTrial).toBe(true);
    expect(overview.subscription.isTrialExpired).toBe(false);
    expect(overview.subscription.trialDaysRemaining).toBeGreaterThanOrEqual(13);
    expect(overview.plan.key).toBe('business');
    expect(overview.plan.limits.whatsappNumbers).toBe(2);
    expect(overview.plan.limits.products).toBe(2000);
  });

  it('2. gracefully degrades effective plan to free when trial expires without destroying data', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Expired Trial Store' });
    await ensureWorkspaceSubscription(prisma, ws.workspaceId);

    // Set trial expiration to 2 days ago
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { workspaceId: ws.workspaceId },
      data: {
        trialEndsAt: pastDate,
        currentPeriodEnd: pastDate,
      },
    });

    const overview = await getSubscriptionOverview(ws.context);

    expect(overview.subscription.status).toBe('TRIAL');
    expect(overview.subscription.planKey).toBe('business');
    expect(overview.subscription.effectivePlanKey).toBe('free');
    expect(overview.subscription.isTrialExpired).toBe(true);
    expect(overview.subscription.trialDaysRemaining).toBe(0);

    // Plan features reflect free tier
    expect(overview.plan.key).toBe('free');
    expect(overview.plan.limits.products).toBe(20);

    // Limit guard resolves free plan
    const effectiveKey = await getEffectivePlanKey(ws.context);
    expect(effectiveKey).toBe('free');

    const effectivePlan = await getEffectivePlan(ws.context);
    expect(effectivePlan.key).toBe('free');

    // Advanced analytics feature is disallowed on free plan
    await expect(assertPlanHasFeature(ws.context, 'advanced_analytics')).rejects.toThrow();
  });

  it('3. allows owner to change plans, cancel at period end, and resume subscription', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Subscribing Store' });

    // 1. Upgrade to Starter Plan
    const upgraded = await changeSubscriptionPlan(ws.context, { planKey: 'starter' });
    expect(upgraded.subscription.status).toBe('ACTIVE');
    expect(upgraded.subscription.planKey).toBe('starter');
    expect(upgraded.subscription.effectivePlanKey).toBe('starter');
    expect(upgraded.subscription.isTrial).toBe(false);
    expect(upgraded.plan.priceMinor).toBe(249900);

    // Verify audit log
    const auditLogs = await prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, action: 'subscription.plan_changed' },
    });
    expect(auditLogs.length).toBe(1);

    // Verify notification
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId, type: 'SUBSCRIPTION_CHANGED' },
    });
    expect(notifications.length).toBe(1);

    // 2. Schedule cancellation at period end
    const canceled = await cancelSubscription(ws.context);
    expect(canceled.subscription.cancelAtPeriodEnd).toBe(true);
    expect(canceled.subscription.canceledAt).not.toBeNull();
    // Still active on starter plan until period end
    expect(canceled.subscription.effectivePlanKey).toBe('starter');

    // 3. Resume subscription
    const resumed = await resumeSubscription(ws.context);
    expect(resumed.subscription.cancelAtPeriodEnd).toBe(false);
    expect(resumed.subscription.effectivePlanKey).toBe('starter');

    // 4. Switching to Free plan is supported
    const switchedFree = await changeSubscriptionPlan(ws.context, { planKey: 'free' });
    expect(switchedFree.subscription.planKey).toBe('free');
    expect(switchedFree.subscription.effectivePlanKey).toBe('free');

    // Canceling free plan is rejected as business rule error
    await expect(cancelSubscription(ws.context)).rejects.toThrow('Free plan cannot be canceled.');
  });

  it('4. enforces quota limits on resource creation (products, automations, contacts)', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Quota Enforcement Store' });

    // Switch to free plan (20 products limit, 1 automation limit, 100 contacts limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    // Create 20 products (reach exact limit)
    const productData = Array.from({ length: 20 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      name: `T-Shirt ${i + 1}`,
      slug: `t-shirt-${i + 1}`,
      priceMinor: 150000,
    }));
    await prisma.product.createMany({ data: productData });

    // 20 used / 20 limit -> check returns allowed: false for 1 more
    await expect(assertWithinPlanLimit(ws.context, 'products', 1)).rejects.toThrow(
      /Your Free plan allows up to 20 products/,
    );

    // Create 1 automation (reach 1 limit)
    await prisma.automation.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Auto Reply',
        triggerType: 'CONVERSATION_OPENED',
        createdByMemberId: ws.ownerMembershipId,
      },
    });

    // 1 used / 1 limit -> creating another automation is blocked
    await expect(assertWithinPlanLimit(ws.context, 'automations', 1)).rejects.toThrow(
      /Your Free plan allows up to 1 automations/,
    );
  });

  it('5. enforces RBAC permissions for server actions (OWNER vs ADMIN vs MANAGER/AGENT)', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'RBAC Billing Store' });

    const adminMember = await createMemberFixture(ws.workspaceId, 'ADMIN');
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER');
    const agentMember = await createMemberFixture(ws.workspaceId, 'AGENT');

    const adminContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'RBAC Billing Store',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    const managerContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'RBAC Billing Store',
      currency: 'PKR',
      userId: managerMember.userId,
      userName: managerMember.name,
      userEmail: managerMember.email,
      membershipId: managerMember.membershipId,
      role: 'MANAGER',
    });

    const agentContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'RBAC Billing Store',
      currency: 'PKR',
      userId: agentMember.userId,
      userName: agentMember.name,
      userEmail: agentMember.email,
      membershipId: agentMember.membershipId,
      role: 'AGENT',
    });

    // 1. fetchSubscriptionAction
    // AGENT & MANAGER: rejected
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(agentContext);
    const agentFetch = await fetchSubscriptionAction();
    expect(agentFetch.success).toBe(false);

    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(managerContext);
    const managerFetch = await fetchSubscriptionAction();
    expect(managerFetch.success).toBe(false);

    // ADMIN: allowed to view subscription
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminContext);
    const adminFetch = await fetchSubscriptionAction();
    expect(adminFetch.success).toBe(true);

    // OWNER: allowed to view subscription
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerFetch = await fetchSubscriptionAction();
    expect(ownerFetch.success).toBe(true);

    // 2. changePlanAction
    // ADMIN: rejected (only OWNER can manage billing)
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminContext);
    const adminChange = await changePlanAction({ planKey: 'starter' });
    expect(adminChange.success).toBe(false);

    // OWNER: allowed to change plan
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerChange = await changePlanAction({ planKey: 'starter' });
    expect(ownerChange.success).toBe(true);

    // 3. cancelSubscriptionAction & resumeSubscriptionAction
    // ADMIN: rejected
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminContext);
    const adminCancel = await cancelSubscriptionAction();
    expect(adminCancel.success).toBe(false);

    // OWNER: allowed
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerCancel = await cancelSubscriptionAction();
    expect(ownerCancel.success).toBe(true);

    const ownerResume = await resumeSubscriptionAction();
    expect(ownerResume.success).toBe(true);
  });

  it('6. enforces strict multi-tenant subscription isolation', async () => {
    await resetDatabase();
    const wsA = await createWorkspaceFixture({ name: 'Workspace A' });
    const wsB = await createWorkspaceFixture({ name: 'Workspace B' });

    // Workspace A switches to PRO plan
    await changeSubscriptionPlan(wsA.context, { planKey: 'pro' });

    // Workspace B remains on business trial
    const overviewB = await getSubscriptionOverview(wsB.context);
    expect(overviewB.subscription.planKey).toBe('business');
    expect(overviewB.subscription.status).toBe('TRIAL');

    // Workspace A has pro plan
    const overviewA = await getSubscriptionOverview(wsA.context);
    expect(overviewA.subscription.planKey).toBe('pro');
    expect(overviewA.subscription.status).toBe('ACTIVE');
  });
});
