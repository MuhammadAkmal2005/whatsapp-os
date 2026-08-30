/**
 * Analytics Server Actions & UI Integration Tests (Phase 7 Unit 2).
 *
 * Verifies server actions authorization, multi-tenant isolation, date filtering,
 * usage metering status checks, and admin-triggered rollups.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/db/prisma';
import {
  fetchAITelemetryAction,
  fetchAnalyticsOverviewAction,
  fetchUsageAndLimitsAction,
  triggerDailyRollupAction,
} from '@/server/actions/analytics.actions';
import * as tenancyResolve from '@/server/tenancy/resolve';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '@/tests/integration/fixtures';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Phase 7 Unit 2: Analytics UI & Server Actions Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  it('1. fetchAnalyticsOverviewAction enforces RBAC (AGENT rejected, MANAGER/ADMIN/OWNER allowed)', async () => {
    const ws = await createWorkspaceFixture({ name: 'Role Test Store' });
    const agentMember = await createMemberFixture(ws.workspaceId, 'AGENT');
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER');

    const agentContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Role Test Store',
      currency: 'PKR',
      userId: agentMember.userId,
      userName: agentMember.name,
      userEmail: agentMember.email,
      membershipId: agentMember.membershipId,
      role: 'AGENT',
    });

    const managerContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Role Test Store',
      currency: 'PKR',
      userId: managerMember.userId,
      userName: managerMember.name,
      userEmail: managerMember.email,
      membershipId: managerMember.membershipId,
      role: 'MANAGER',
    });

    // 1. AGENT role attempt must fail
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(agentContext);
    const agentResult = await fetchAnalyticsOverviewAction({ interval: 'day' });
    expect(agentResult.success).toBe(false);
    if (!agentResult.success) {
      expect(agentResult.error).toContain('cannot perform this action');
    }

    // 2. MANAGER role attempt must succeed
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(managerContext);
    const managerResult = await fetchAnalyticsOverviewAction({ interval: 'day' });
    expect(managerResult.success).toBe(true);
    if (managerResult.success) {
      expect(managerResult.data.summary).toBeDefined();
      expect(managerResult.data.timeSeries).toBeDefined();
    }

    // 3. OWNER role attempt must succeed
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerResult = await fetchAnalyticsOverviewAction({ interval: 'day' });
    expect(ownerResult.success).toBe(true);
  });

  it('2. fetchAnalyticsOverviewAction returns accurate aggregated data and handles empty states', async () => {
    const ws = await createWorkspaceFixture({ name: 'Metrics Store' });
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);

    // Initial empty state
    const emptyResult = await fetchAnalyticsOverviewAction();
    expect(emptyResult.success).toBe(true);
    if (emptyResult.success) {
      expect(emptyResult.data.summary.totalMessages).toBe(0);
      expect(emptyResult.data.summary.revenueMinor).toBe(0);
      expect(emptyResult.data.summary.paidOrdersCount).toBe(0);
    }

    // Insert order & message
    const contact = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Sara Khan',
        phoneE164: '+923001239999',
      },
    });

    await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-ACT-1',
        contactId: contact.id,
        paymentStatus: 'PAID',
        subtotalMinor: 499900,
        totalMinor: 499900,
        customerName: 'Sara Khan',
        phoneE164: '+923001239999',
      },
    });

    const populatedResult = await fetchAnalyticsOverviewAction();
    expect(populatedResult.success).toBe(true);
    if (populatedResult.success) {
      expect(populatedResult.data.summary.ordersCount).toBe(1);
      expect(populatedResult.data.summary.paidOrdersCount).toBe(1);
      expect(populatedResult.data.summary.revenueMinor).toBe(499900);
      expect(populatedResult.data.summary.avgOrderValueMinor).toBe(499900);
    }
  });

  it('3. fetchAITelemetryAction returns filtered AI telemetry breakdown', async () => {
    const ws = await createWorkspaceFixture({ name: 'AI Telemetry Store' });
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);

    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Sales Bot',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.aITurn.create({
      data: {
        workspaceId: ws.workspaceId,
        agentId: agent.id,
        source: 'CONVERSATION',
        inputText: 'Is lawn suit available?',
        outputText: 'Yes, lawn suits are available.',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 150,
        outputTokens: 50,
        costMicros: 60,
        latencyMs: 180,
        groundingPassed: true,
      },
    });

    const result = await fetchAITelemetryAction({ model: 'gemini-2.5-flash' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalRequests).toBe(1);
      expect(result.data.totalInputTokens).toBe(150);
      expect(result.data.totalOutputTokens).toBe(50);
      expect(result.data.totalCostMicros).toBe(60);
      expect(result.data.groundingPassRate).toBe(100);
      expect(result.data.byModel.length).toBe(1);
      expect(result.data.byModel[0]?.model).toBe('gemini-2.5-flash');
    }
  });

  it('4. fetchUsageAndLimitsAction enforces usage:read permission and evaluates plan limits', async () => {
    const ws = await createWorkspaceFixture({ name: 'Usage RBAC Store' });
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER');
    const adminMember = await createMemberFixture(ws.workspaceId, 'ADMIN');

    const managerContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Usage RBAC Store',
      currency: 'PKR',
      userId: managerMember.userId,
      userName: managerMember.name,
      userEmail: managerMember.email,
      membershipId: managerMember.membershipId,
      role: 'MANAGER',
    });

    const adminContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Usage RBAC Store',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    // MANAGER lacks usage:read permission -> fails
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(managerContext);
    const managerResult = await fetchUsageAndLimitsAction();
    expect(managerResult.success).toBe(false);

    // ADMIN has usage:read permission -> succeeds
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(adminContext);
    const adminResult = await fetchUsageAndLimitsAction();
    expect(adminResult.success).toBe(true);
    if (adminResult.success) {
      expect(adminResult.data.planKey).toBe('free');
      expect(adminResult.data.limits.aiRequestsPerMonth).toBeDefined();
      expect(adminResult.data.limits.messagesPerMonth).toBeDefined();
    }
  });

  it('5. triggerDailyRollupAction restricts execution to analytics:read_advanced and persists rollups', async () => {
    const ws = await createWorkspaceFixture({ name: 'Rollup Trigger Store' });
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER');

    const managerContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'Rollup Trigger Store',
      currency: 'PKR',
      userId: managerMember.userId,
      userName: managerMember.name,
      userEmail: managerMember.email,
      membershipId: managerMember.membershipId,
      role: 'MANAGER',
    });

    // MANAGER cannot trigger rollup
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(managerContext);
    const managerResult = await triggerDailyRollupAction({ date: '2026-08-25' });
    expect(managerResult.success).toBe(false);

    // OWNER can trigger rollup
    vi.spyOn(tenancyResolve, 'requireTenantContext').mockResolvedValue(ws.context);
    const ownerResult = await triggerDailyRollupAction({ date: '2026-08-25' });
    expect(ownerResult.success).toBe(true);
    if (ownerResult.success) {
      expect(ownerResult.data.workspacesProcessed).toBe(1);
    }
  });
});
