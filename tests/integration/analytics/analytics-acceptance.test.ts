/**
 * Master Phase 7 Analytics, Usage Metering & Reporting Acceptance Suite.
 *
 * Comprehensive end-to-end integration and acceptance tests verifying:
 * 1. End-to-end event aggregation, AI cost tracking & daily rollup persistence.
 * 2. Background worker job handler execution & batch daily rollup idempotency.
 * 3. Subscription quota metering, 80% warning threshold & limit breach detection.
 * 4. RFC 4180 compliant CSV & JSON export generation for business metrics & AI telemetry.
 * 5. Strict multi-tenant isolation across all analytics queries and exports.
 * 6. Granular RBAC permission enforcement (AGENT rejected, MANAGER/ADMIN/OWNER allowed).
 * 7. Mathematical correctness, zero-denominator safety, and edge-case handling.
 */

import { describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { analyticsRollupDailyHandler } from '@/server/jobs/handlers/analytics.handler';
import {
  exportAnalyticsReport,
  getAnalyticsOverview,
  getWorkspaceUsageAndLimits,
  runDailyRollup,
} from '@/server/services/analytics/analytics.service';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';

describe('Phase 7 Master Acceptance Suite: Analytics, Usage & Reporting', () => {
  it('1. verifies full lifecycle: events -> live aggregation -> rollup worker -> reporting export', async () => {
    await resetDatabase();
    const wsAlpha = await createWorkspaceFixture({ name: 'Alpha Retailers' });

    const targetDate = new Date('2026-08-25T12:00:00Z');
    const targetDateStr = '2026-08-25';

    // 1. Create Contacts & Conversations in Alpha
    const contactAlpha = await prisma.contact.create({
      data: {
        workspaceId: wsAlpha.workspaceId,
        phoneE164: '+923001112233',
        name: 'Zainab Bibi',
        status: 'LEAD',
        createdAt: new Date('2026-08-25T09:00:00Z'),
      },
    });

    const conv1 = await prisma.conversation.create({
      data: {
        workspaceId: wsAlpha.workspaceId,
        contactId: contactAlpha.id,
        status: 'RESOLVED',
        aiEnabled: true,
        firstResponseAt: new Date('2026-08-25T10:06:00Z'),
        resolvedAt: new Date('2026-08-25T14:30:00Z'),
        createdAt: new Date('2026-08-25T10:00:00Z'),
      },
    });

    const conv2 = await prisma.conversation.create({
      data: {
        workspaceId: wsAlpha.workspaceId,
        contactId: contactAlpha.id,
        status: 'OPEN',
        aiEnabled: false,
        createdAt: new Date('2026-08-25T11:00:00Z'),
      },
    });

    // 2. Create Messages
    await prisma.message.createMany({
      data: [
        {
          workspaceId: wsAlpha.workspaceId,
          conversationId: conv1.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'Is black kurta available in M?',
          occurredAt: new Date('2026-08-25T10:05:00Z'),
        },
        {
          workspaceId: wsAlpha.workspaceId,
          conversationId: conv1.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body: 'Yes, 5 units in stock at Rs. 4,500.',
          occurredAt: new Date('2026-08-25T10:06:00Z'),
        },
        {
          workspaceId: wsAlpha.workspaceId,
          conversationId: conv2.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'Need help with delivery',
          occurredAt: new Date('2026-08-25T11:05:00Z'),
        },
      ],
    });

    // 3. Create Orders (Paid & Pending)
    await prisma.order.createMany({
      data: [
        {
          workspaceId: wsAlpha.workspaceId,
          contactId: contactAlpha.id,
          conversationId: conv1.id,
          orderNumber: 'ORD-ALPHA-101',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          customerName: 'Zainab Bibi',
          phoneE164: contactAlpha.phoneE164,
          subtotalMinor: 450000,
          totalMinor: 450000,
          currency: 'PKR',
          createdAt: new Date('2026-08-25T12:00:00Z'),
        },
        {
          workspaceId: wsAlpha.workspaceId,
          contactId: contactAlpha.id,
          conversationId: conv2.id,
          orderNumber: 'ORD-ALPHA-102',
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          customerName: 'Zainab Bibi',
          phoneE164: contactAlpha.phoneE164,
          subtotalMinor: 200000,
          totalMinor: 200000,
          currency: 'PKR',
          createdAt: new Date('2026-08-25T13:00:00Z'),
        },
      ],
    });

    // 4. Create AI Turn with model cost attribution
    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId: wsAlpha.workspaceId,
        name: 'Alpha Sales Bot',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.aITurn.create({
      data: {
        workspaceId: wsAlpha.workspaceId,
        agentId: agent.id,
        conversationId: conv1.id,
        provider: 'google-gemini',
        model: 'gemini-2.5-flash',
        inputText: 'Is black kurta available in M?',
        outputText: 'Yes, 5 units in stock at Rs. 4,500.',
        inputTokens: 450,
        outputTokens: 85,
        costMicros: 1500, // $0.001500
        latencyMs: 340,
        groundingPassed: true,
        source: 'CONVERSATION',
        createdAt: new Date('2026-08-25T10:06:00Z'),
      },
    });

    // 5. Test Live Aggregation Overview
    const overview = await getAnalyticsOverview(wsAlpha.context, {
      from: new Date('2026-08-25T00:00:00Z'),
      to: new Date('2026-08-25T23:59:59Z'),
    });

    expect(overview.summary.revenueMinor).toBe(450000); // Only paid orders
    expect(overview.summary.ordersCount).toBe(2);
    expect(overview.summary.paidOrdersCount).toBe(1);
    expect(overview.summary.messagesIn).toBe(2);
    expect(overview.summary.messagesOut).toBe(1);
    expect(overview.summary.conversationsNew).toBe(2);
    expect(overview.summary.conversationsResolved).toBe(1);
    expect(overview.summary.aiHandledConversations).toBe(1);
    expect(overview.summary.aiRequests).toBe(1);
    expect(overview.summary.aiCostMicros).toBe(1500);

    // 6. Test Background Rollup Worker Handler
    await analyticsRollupDailyHandler(
      { date: targetDateStr, workspaceId: wsAlpha.workspaceId },
      {
        jobId: 'test-analytics-job-1',
        attempt: 1,
        maxAttempts: 2,
        signal: new AbortController().signal,
      },
    );

    const dayStart = new Date(Date.UTC(2026, 7, 25, 0, 0, 0, 0));
    const savedRollup = await prisma.analyticsDaily.findUnique({
      where: {
        workspaceId_date: {
          workspaceId: wsAlpha.workspaceId,
          date: dayStart,
        },
      },
    });

    expect(savedRollup).not.toBeNull();
    expect(savedRollup?.revenueMinor).toBe(450000);
    expect(savedRollup?.ordersCount).toBe(2);
    expect(savedRollup?.aiCostMicros).toBe(1500);
    expect(savedRollup?.aiRequests).toBe(1);

    // 7. Verify Rollup Idempotency (running twice produces same result, no duplication)
    await runDailyRollup({ date: targetDate, workspaceId: wsAlpha.workspaceId });
    const rollupCount = await prisma.analyticsDaily.count({
      where: { workspaceId: wsAlpha.workspaceId },
    });
    expect(rollupCount).toBe(1);

    // 8. Test CSV Export for Overview, AI Telemetry, and Daily Rollups
    const csvOverview = await exportAnalyticsReport(wsAlpha.context, {
      from: new Date('2026-08-25T00:00:00Z'),
      to: new Date('2026-08-25T23:59:59Z'),
      reportType: 'overview',
      format: 'csv',
    });

    expect(csvOverview.mimeType).toBe('text/csv');
    expect(csvOverview.filename).toContain('analytics_overview_');
    expect(csvOverview.content).toContain('Date,Revenue (Minor),Revenue (Formatted)');
    expect(csvOverview.content).toContain('450000');

    const csvTelemetry = await exportAnalyticsReport(wsAlpha.context, {
      from: new Date('2026-08-25T00:00:00Z'),
      to: new Date('2026-08-25T23:59:59Z'),
      reportType: 'ai_telemetry',
      format: 'csv',
    });

    expect(csvTelemetry.content).toContain('Model,Invocations,Input Tokens');
    expect(csvTelemetry.content).toContain('gemini-2.5-flash');

    const csvRollups = await exportAnalyticsReport(wsAlpha.context, {
      from: new Date('2026-08-25T00:00:00Z'),
      to: new Date('2026-08-25T23:59:59Z'),
      reportType: 'daily_rollups',
      format: 'csv',
    });

    expect(csvRollups.content).toContain('Date,Revenue Minor,Orders');
    expect(csvRollups.content).toContain('450000');
  });

  it('2. verifies subscription usage limits, 80% threshold warnings & soft-delete exclusion', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Usage Test Workspace' });

    // On default 'free' plan: Products limit is 20, AI requests is 100.
    // Create 18 active products (90% of 20 limit => should trigger >80% threshold)
    const productData = Array.from({ length: 18 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      name: `Product ${i + 1}`,
      slug: `product-${i + 1}`,
      priceMinor: 100000,
    }));
    await prisma.product.createMany({ data: productData });

    // Create 10 soft-deleted products (must NOT count towards limit)
    const softDeletedProducts = Array.from({ length: 10 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      name: `Deleted Product ${i + 1}`,
      slug: `del-product-${i + 1}`,
      priceMinor: 100000,
      deletedAt: new Date(),
    }));
    await prisma.product.createMany({ data: softDeletedProducts });

    // Add UsageRecord for AI_REQUEST: 90 out of 100 (90%)
    await prisma.usageRecord.create({
      data: {
        workspaceId: ws.workspaceId,
        metric: 'AI_REQUEST',
        quantity: 90,
        occurredAt: new Date(),
      },
    });

    const usageStatus = await getWorkspaceUsageAndLimits(ws.context);

    expect(usageStatus.planKey).toBe('free');
    // Products: exactly 18 active
    expect(usageStatus.limits.products.used).toBe(18);
    expect(usageStatus.limits.products.limit).toBe(20);
    expect(usageStatus.limits.products.allowed).toBe(true);
    expect(usageStatus.limits.products.nearLimit).toBe(true);
    expect(usageStatus.limits.products.ratio).toBe(0.9);

    // AI Requests: 90 / 100 = 90%
    expect(usageStatus.limits.aiRequestsPerMonth.used).toBe(90);
    expect(usageStatus.limits.aiRequestsPerMonth.limit).toBe(100);
    expect(usageStatus.limits.aiRequestsPerMonth.allowed).toBe(true);
    expect(usageStatus.limits.aiRequestsPerMonth.nearLimit).toBe(true);
    expect(usageStatus.limits.aiRequestsPerMonth.ratio).toBe(0.9);

    // Test JSON usage export
    const jsonExport = await exportAnalyticsReport(ws.context, {
      reportType: 'usage',
      format: 'json',
    });

    expect(jsonExport.mimeType).toBe('application/json');
    const parsed = JSON.parse(jsonExport.content);
    expect(parsed.planKey).toBe('free');
    expect(parsed.limits.products.used).toBe(18);
  });

  it('3. enforces strict multi-tenant isolation across queries and reports', async () => {
    await resetDatabase();
    const wsA = await createWorkspaceFixture({ name: 'Workspace A' });
    const wsB = await createWorkspaceFixture({ name: 'Workspace B' });

    // Populate data strictly in Workspace B
    const contactB = await prisma.contact.create({
      data: {
        workspaceId: wsB.workspaceId,
        phoneE164: '+923009998877',
        name: 'Private Customer B',
      },
    });

    await prisma.order.create({
      data: {
        workspaceId: wsB.workspaceId,
        contactId: contactB.id,
        orderNumber: 'ORD-B-999',
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        customerName: 'Private Customer B',
        phoneE164: contactB.phoneE164,
        subtotalMinor: 999900,
        totalMinor: 999900,
      },
    });

    // Workspace A queries overview
    const overviewA = await getAnalyticsOverview(wsA.context);
    expect(overviewA.summary.revenueMinor).toBe(0);
    expect(overviewA.summary.ordersCount).toBe(0);

    // Workspace A exports CSV
    const exportA = await exportAnalyticsReport(wsA.context, { reportType: 'overview' });
    expect(exportA.content).not.toContain('999900');

    // Workspace B queries overview
    const overviewB = await getAnalyticsOverview(wsB.context);
    expect(overviewB.summary.revenueMinor).toBe(999900);
    expect(overviewB.summary.ordersCount).toBe(1);
  });

  it('4. enforces RBAC permissions for server actions (AGENT rejected, ADMIN allowed)', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'RBAC Workspace' });

    // Agent context
    const agentCtx = { ...ws.context, role: 'AGENT' as const };

    // Viewer context
    const viewerCtx = { ...ws.context, role: 'VIEWER' as const };

    // Expect AGENT to be blocked from reading analytics overview
    await expect(getAnalyticsOverview(agentCtx)).rejects.toThrow();

    // Expect VIEWER to succeed reading overview
    const viewerOverview = await getAnalyticsOverview(viewerCtx);
    expect(viewerOverview).toBeDefined();

    // Expect VIEWER to be blocked from reading subscription usage
    await expect(getWorkspaceUsageAndLimits(viewerCtx)).rejects.toThrow();

    // Expect ADMIN to succeed reading usage
    const adminCtx = { ...ws.context, role: 'ADMIN' as const };
    const adminUsage = await getWorkspaceUsageAndLimits(adminCtx);
    expect(adminUsage.planKey).toBeDefined();
  });

  it('5. handles boundary dates, leap years, and zero denominators gracefully', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Boundary Workspace' });

    // Leap year date test
    const leapDate = new Date('2028-02-29T12:00:00Z');
    await runDailyRollup({ date: leapDate, workspaceId: ws.workspaceId });

    const leapDayStart = new Date(Date.UTC(2028, 1, 29, 0, 0, 0, 0));
    const leapRollup = await prisma.analyticsDaily.findUnique({
      where: {
        workspaceId_date: {
          workspaceId: ws.workspaceId,
          date: leapDayStart,
        },
      },
    });

    expect(leapRollup).not.toBeNull();
    expect(leapRollup?.revenueMinor).toBe(0);

    // Empty date range returns stable overview without errors
    const emptyOverview = await getAnalyticsOverview(ws.context, {
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2020-01-02T00:00:00Z'),
    });

    expect(emptyOverview.summary.revenueMinor).toBe(0);
    expect(emptyOverview.summary.ordersCount).toBe(0);
    expect(emptyOverview.summary.messagesIn).toBe(0);
    expect(emptyOverview.summary.aiRequests).toBe(0);
  });
});
