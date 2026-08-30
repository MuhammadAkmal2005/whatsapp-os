import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db/prisma';
import {
  cancelSubscriptionAction,
  changePlanAction,
  fetchBillingOverviewAction,
  resumeSubscriptionAction,
} from '@/server/actions/subscription.actions';
import * as tenancyResolve from '@/server/tenancy/resolve';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '../fixtures';

describe('Phase 8 Unit 2: Billing UI & Server Actions Integration', () => {
  it('1. enforces RBAC on fetchBillingOverviewAction and returns complete quota usage metrics', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Alpha Logistics' });

    const adminMember = await createMemberFixture(ws.workspaceId, 'ADMIN');
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER');
    const agentMember = await createMemberFixture(ws.workspaceId, 'AGENT');

    const adminCtx = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Alpha Logistics',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    const managerCtx = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Alpha Logistics',
      currency: 'PKR',
      userId: managerMember.userId,
      userName: managerMember.name,
      userEmail: managerMember.email,
      membershipId: managerMember.membershipId,
      role: 'MANAGER',
    });

    const agentCtx = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Alpha Logistics',
      currency: 'PKR',
      userId: agentMember.userId,
      userName: agentMember.name,
      userEmail: agentMember.email,
      membershipId: agentMember.membershipId,
      role: 'AGENT',
    });

    // AGENT & MANAGER: rejected
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(agentCtx);
    const agentFetch = await fetchBillingOverviewAction();
    expect(agentFetch.success).toBe(false);

    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(managerCtx);
    const managerFetch = await fetchBillingOverviewAction();
    expect(managerFetch.success).toBe(false);

    // ADMIN: allowed to view billing, canManage: false
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminCtx);
    const adminFetch = await fetchBillingOverviewAction();
    expect(adminFetch.success).toBe(true);
    if (adminFetch.success) {
      expect(adminFetch.data.canManage).toBe(false);
      expect(adminFetch.data.allPlans.length).toBe(4);
      expect(adminFetch.data.quotaUsage.length).toBe(10);
      expect(adminFetch.data.subscription.isTrial).toBe(true);
    }

    // OWNER: allowed to view billing, canManage: true
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerFetch = await fetchBillingOverviewAction();
    expect(ownerFetch.success).toBe(true);
    if (ownerFetch.success) {
      expect(ownerFetch.data.canManage).toBe(true);
      expect(ownerFetch.data.plan.key).toBe('business');
      expect(ownerFetch.data.subscription.planKey).toBe('business');
    }
  });

  it('2. changes workspace subscription plan with OWNER authority and validates catalogue state', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Retail Store Pro' });

    const adminMember = await createMemberFixture(ws.workspaceId, 'ADMIN');
    const adminCtx = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Retail Store Pro',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    // ADMIN attempt to change plan -> rejected
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminCtx);
    const adminChange = await changePlanAction({ planKey: 'pro' });
    expect(adminChange.success).toBe(false);

    // OWNER switches to Starter plan -> succeeds
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerChange = await changePlanAction({ planKey: 'starter' });
    expect(ownerChange.success).toBe(true);
    if (ownerChange.success) {
      expect(ownerChange.data.plan.key).toBe('starter');
      expect(ownerChange.data.subscription.status).toBe('ACTIVE');
      expect(ownerChange.data.subscription.isTrial).toBe(false);
    }

    // Verify DB update
    const dbSub = await prisma.subscription.findUnique({
      where: { workspaceId: ws.workspaceId },
    });
    expect(dbSub?.planKey).toBe('starter');
    expect(dbSub?.status).toBe('ACTIVE');
  });

  it('3. executes cancel and resume subscription lifecycle via server actions', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Cancel Resume Shop' });

    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);

    // Set active starter plan
    await changePlanAction({ planKey: 'starter' });

    // Cancel subscription
    const cancelRes = await cancelSubscriptionAction();
    expect(cancelRes.success).toBe(true);
    if (cancelRes.success) {
      expect(cancelRes.data.subscription.cancelAtPeriodEnd).toBe(true);
      expect(cancelRes.data.subscription.canceledAt).not.toBeNull();
    }

    // Resume subscription
    const resumeRes = await resumeSubscriptionAction();
    expect(resumeRes.success).toBe(true);
    if (resumeRes.success) {
      expect(resumeRes.data.subscription.cancelAtPeriodEnd).toBe(false);
      expect(resumeRes.data.subscription.canceledAt).toBeNull();
    }
  });
});
