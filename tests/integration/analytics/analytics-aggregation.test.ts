/**
 * Analytics Aggregation & Usage Metering Integration Tests (Phase 7 Unit 1).
 *
 * Verifies multi-dimensional data aggregation, exact mathematical revenue and message counts,
 * AI cost attribution, usage metering, daily rollups, and strict tenant isolation.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import {
  getAnalyticsOverview,
  getAITelemetry,
  getWorkspaceUsageAndLimits,
  runDailyRollup,
} from '@/server/services/analytics/analytics.service';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '@/tests/integration/fixtures';

describe('Phase 7 Unit 1: Analytics Aggregation & Metering Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('1. aggregates messaging, commerce, CRM, and AI telemetry with exact mathematical precision', async () => {
    const ws = await createWorkspaceFixture({ name: 'Khaadi Apparel' });
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-31T23:59:59Z');

    // 1. Create Contacts
    const contact1 = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Zainab Bibi',
        phoneE164: '+923001112233',
        status: 'LEAD',
        createdAt: new Date('2026-08-10T10:00:00Z'),
      },
    });

    const contact2 = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Bilal Khan',
        phoneE164: '+923004445566',
        status: 'ACTIVE',
        createdAt: new Date('2026-08-15T10:00:00Z'),
      },
    });

    // 2. Create Conversations
    const conv1 = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact1.id,
        status: 'RESOLVED',
        aiEnabled: true,
        firstResponseAt: new Date('2026-08-10T10:07:00Z'), // 2 min first response (120,000 ms from 10:05)
        resolvedAt: new Date('2026-08-10T10:25:00Z'), // 20 min resolution (1,200,000 ms from 10:05)
        createdAt: new Date('2026-08-10T10:05:00Z'),
      },
    });

    const conv2 = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact2.id,
        status: 'OPEN',
        aiEnabled: false,
        handoffAt: new Date('2026-08-15T11:00:00Z'),
        handoffReason: 'MANUAL_TAKEOVER',
        createdAt: new Date('2026-08-15T10:30:00Z'),
      },
    });

    // 3. Create Messages
    await prisma.message.createMany({
      data: [
        {
          workspaceId: ws.workspaceId,
          conversationId: conv1.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'Hello, what is the price of Kurta?',
          occurredAt: new Date('2026-08-10T10:05:00Z'),
        },
        {
          workspaceId: ws.workspaceId,
          conversationId: conv1.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body: 'Price is Rs. 3,499.',
          occurredAt: new Date('2026-08-10T10:07:00Z'),
        },
        {
          workspaceId: ws.workspaceId,
          conversationId: conv2.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'I want to speak with a human agent.',
          occurredAt: new Date('2026-08-15T10:30:00Z'),
        },
        {
          workspaceId: ws.workspaceId,
          conversationId: conv2.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body: 'Transferring you right now.',
          occurredAt: new Date('2026-08-15T10:32:00Z'),
        },
      ],
    });

    // 4. Create Product & Orders
    await prisma.product.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Black Kurta',
        priceMinor: 349900,
        slug: 'black-kurta',
      },
    });

    // Order 1: Paid, human created
    await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-001',
        contactId: contact1.id,
        conversationId: conv1.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        fulfillmentStatus: 'FULFILLED',
        currency: 'PKR',
        subtotalMinor: 349900,
        totalMinor: 349900,
        customerName: 'Zainab Bibi',
        phoneE164: '+923001112233',
        createdByAi: false,
        createdAt: new Date('2026-08-10T11:00:00Z'),
      },
    });

    // Order 2: Paid, AI created
    await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-002',
        contactId: contact2.id,
        conversationId: conv2.id,
        status: 'PENDING',
        paymentStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        currency: 'PKR',
        subtotalMinor: 699800,
        totalMinor: 724800, // Rs. 7,248 with delivery
        customerName: 'Bilal Khan',
        phoneE164: '+923004445566',
        createdByAi: true,
        createdAt: new Date('2026-08-15T12:00:00Z'),
      },
    });

    // Order 3: Unpaid / Pending
    await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-003',
        contactId: contact2.id,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        currency: 'PKR',
        subtotalMinor: 100000,
        totalMinor: 100000,
        customerName: 'Bilal Khan',
        phoneE164: '+923004445566',
        createdAt: new Date('2026-08-16T12:00:00Z'),
      },
    });

    // 5. Create Agent & AI Turns
    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Sales Assistant',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.aITurn.create({
      data: {
        workspaceId: ws.workspaceId,
        agentId: agent.id,
        conversationId: conv1.id,
        source: 'CONVERSATION',
        inputText: 'What is the price of Kurta?',
        outputText: 'Price is Rs. 3,499.',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        groundingPassed: true,
        inputTokens: 500,
        outputTokens: 50,
        costMicros: 105,
        latencyMs: 320,
        createdAt: new Date('2026-08-10T10:06:00Z'),
      },
    });

    await prisma.aITurn.create({
      data: {
        workspaceId: ws.workspaceId,
        agentId: agent.id,
        conversationId: conv2.id,
        source: 'CONVERSATION',
        inputText: 'Can I get 90% discount?',
        outputText: null,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        groundingPassed: false,
        blockedReason: 'UNSUPPORTED_DISCOUNT_CLAIM',
        handoffTriggered: true,
        handoffReason: 'LOW_CONFIDENCE',
        inputTokens: 600,
        outputTokens: 0,
        costMicros: 90,
        latencyMs: 250,
        createdAt: new Date('2026-08-15T10:31:00Z'),
      },
    });

    // Execute Service
    const overview = await getAnalyticsOverview(ws.context, { from, to });

    // Assert Exact Figures
    expect(overview.summary.messagesIn).toBe(2);
    expect(overview.summary.messagesOut).toBe(2);
    expect(overview.summary.totalMessages).toBe(4);

    expect(overview.summary.conversationsNew).toBe(2);
    expect(overview.summary.conversationsResolved).toBe(1);
    expect(overview.summary.conversationsOpen).toBe(1);
    expect(overview.summary.conversationsTotal).toBe(2);

    expect(overview.summary.avgFirstResponseMs).toBe(120000); // 2 mins
    expect(overview.summary.avgResolutionMs).toBe(1200000); // 20 mins

    expect(overview.summary.aiHandledConversations).toBe(1);
    expect(overview.summary.handoffCount).toBe(1);
    expect(overview.summary.aiRequests).toBe(2);
    expect(overview.summary.aiInputTokens).toBe(1100);
    expect(overview.summary.aiOutputTokens).toBe(50);
    expect(overview.summary.aiTotalTokens).toBe(1150);
    expect(overview.summary.aiCostMicros).toBe(195);
    expect(overview.summary.groundingPassedCount).toBe(1);
    expect(overview.summary.groundingBlockedCount).toBe(1);

    expect(overview.summary.ordersCount).toBe(3);
    expect(overview.summary.paidOrdersCount).toBe(2);
    // Revenue = Order 1 (349,900) + Order 2 (724,800) = 1,074,700 minor
    expect(overview.summary.revenueMinor).toBe(1074700);
    expect(overview.summary.avgOrderValueMinor).toBe(Math.round(1074700 / 2));
    expect(overview.summary.aiOrdersCount).toBe(1);
    expect(overview.summary.aiRevenueMinor).toBe(724800);

    expect(overview.summary.contactsNew).toBe(2);
    expect(overview.summary.leadsNew).toBe(1);
    expect(overview.summary.contactsTotal).toBe(2);
  });

  it('2. guarantees strict multi-tenant isolation (Workspace A vs Workspace B zero bleed)', async () => {
    const wsA = await createWorkspaceFixture({ name: 'Tenant A' });
    const wsB = await createWorkspaceFixture({ name: 'Tenant B' });

    // Populate data strictly in Workspace A
    const contactA = await prisma.contact.create({
      data: {
        workspaceId: wsA.workspaceId,
        name: 'Customer A',
        phoneE164: '+923001234567',
      },
    });

    await prisma.order.create({
      data: {
        workspaceId: wsA.workspaceId,
        orderNumber: 'ORD-A-01',
        contactId: contactA.id,
        paymentStatus: 'PAID',
        subtotalMinor: 500000,
        totalMinor: 500000,
        customerName: 'Customer A',
        phoneE164: '+923001234567',
      },
    });

    // Query Workspace B
    const overviewB = await getAnalyticsOverview(wsB.context, {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-31'),
    });

    // Assert Workspace B sees honest zeros across all metrics
    expect(overviewB.summary.messagesIn).toBe(0);
    expect(overviewB.summary.messagesOut).toBe(0);
    expect(overviewB.summary.ordersCount).toBe(0);
    expect(overviewB.summary.revenueMinor).toBe(0);
    expect(overviewB.summary.contactsTotal).toBe(0);
    expect(overviewB.summary.aiRequests).toBe(0);
  });

  it('3. enforces RBAC authorization (AGENT cannot read analytics, MANAGER/ADMIN/OWNER can)', async () => {
    const ws = await createWorkspaceFixture({ name: 'RBAC Store' });
    const agentMember = await createMemberFixture(ws.workspaceId, 'AGENT', { name: 'Agent Asad' });
    const managerMember = await createMemberFixture(ws.workspaceId, 'MANAGER', { name: 'Manager Maria' });
    const adminMember = await createMemberFixture(ws.workspaceId, 'ADMIN', { name: 'Admin Ali' });

    const agentContext = tenantContextFor({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspaceSlug,
      workspaceName: 'RBAC Store',
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
      workspaceName: 'RBAC Store',
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
      workspaceName: 'RBAC Store',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    // AGENT attempting to read analytics must throw ForbiddenError (403)
    await expect(
      getAnalyticsOverview(agentContext, { from: new Date('2026-08-01'), to: new Date('2026-08-31') }),
    ).rejects.toThrow();

    // MANAGER succeeds
    const managerData = await getAnalyticsOverview(managerContext, { from: new Date('2026-08-01'), to: new Date('2026-08-31') });
    expect(managerData).toBeDefined();

    // ADMIN succeeds
    const adminData = await getAnalyticsOverview(adminContext, { from: new Date('2026-08-01'), to: new Date('2026-08-31') });
    expect(adminData).toBeDefined();

    // OWNER succeeds
    const ownerData = await getAnalyticsOverview(ws.context, { from: new Date('2026-08-01'), to: new Date('2026-08-31') });
    expect(ownerData).toBeDefined();
  });

  it('4. computes and persists idempotent daily rollups into AnalyticsDaily table', async () => {
    const ws = await createWorkspaceFixture({ name: 'Rollup Mart' });
    const targetDate = new Date('2026-08-20T00:00:00Z');

    // Insert events on target day
    const contact = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Rollup Contact',
        phoneE164: '+923009998877',
        createdAt: new Date('2026-08-20T14:30:00Z'),
      },
    });

    const conv = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        createdAt: new Date('2026-08-20T14:30:00Z'),
        status: 'OPEN',
      },
    });

    await prisma.message.create({
      data: {
        workspaceId: ws.workspaceId,
        conversationId: conv.id,
        direction: 'INBOUND',
        type: 'TEXT',
        body: 'Testing daily rollup',
        occurredAt: new Date('2026-08-20T14:30:00Z'),
      },
    });

    await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-ROLLUP-1',
        contactId: contact.id,
        paymentStatus: 'PAID',
        subtotalMinor: 450000,
        totalMinor: 450000,
        customerName: 'Rollup Contact',
        phoneE164: '+923009998877',
        createdAt: new Date('2026-08-20T15:00:00Z'),
      },
    });

    // 1. Run daily rollup
    const result1 = await runDailyRollup({ date: targetDate, workspaceId: ws.workspaceId });
    expect(result1.workspacesProcessed).toBe(1);

    // Verify row persisted
    const dayStart = new Date(Date.UTC(2026, 7, 20, 0, 0, 0, 0));
    const rollupRow = await prisma.analyticsDaily.findUnique({
      where: {
        workspaceId_date: {
          workspaceId: ws.workspaceId,
          date: dayStart,
        },
      },
    });

    expect(rollupRow).toBeDefined();
    expect(rollupRow?.messagesIn).toBe(1);
    expect(rollupRow?.contactsNew).toBe(1);
    expect(rollupRow?.ordersCount).toBe(1);
    expect(rollupRow?.revenueMinor).toBe(450000);

    // 2. Re-run daily rollup to confirm idempotency (no duplicate key errors)
    const result2 = await runDailyRollup({ date: targetDate, workspaceId: ws.workspaceId });
    expect(result2.workspacesProcessed).toBe(1);

    const countAfter = await prisma.analyticsDaily.count({
      where: { workspaceId: ws.workspaceId },
    });
    expect(countAfter).toBe(1);
  });

  it('5. returns multi-dimensional AI telemetry and model cost breakdowns', async () => {
    const ws = await createWorkspaceFixture({ name: 'AI Insights Store' });
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-31T23:59:59Z');

    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Support Bot',
        model: 'gemini-2.5-flash',
      },
    });

    // Create Turns across different models and sources
    await prisma.aITurn.create({
      data: {
        workspaceId: ws.workspaceId,
        agentId: agent.id,
        source: 'CONVERSATION',
        inputText: 'Hi',
        outputText: 'Hello',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 100,
        outputTokens: 50,
        costMicros: 45,
        latencyMs: 200,
        groundingPassed: true,
        createdAt: new Date('2026-08-10T12:00:00Z'),
      },
    });

    await prisma.aITurn.create({
      data: {
        workspaceId: ws.workspaceId,
        agentId: agent.id,
        source: 'PLAYGROUND',
        inputText: 'Test in playground',
        outputText: 'Test reply',
        provider: 'mock',
        model: 'mock-model',
        inputTokens: 80,
        outputTokens: 40,
        costMicros: 0,
        latencyMs: 150,
        groundingPassed: true,
        createdAt: new Date('2026-08-15T12:00:00Z'),
      },
    });

    const telemetry = await getAITelemetry(ws.context, { from, to });

    expect(telemetry.totalRequests).toBe(2);
    expect(telemetry.totalInputTokens).toBe(180);
    expect(telemetry.totalOutputTokens).toBe(90);
    expect(telemetry.totalCostMicros).toBe(45);
    expect(telemetry.groundingPassRate).toBe(100);

    expect(telemetry.byModel.length).toBe(2);
    expect(telemetry.bySource['CONVERSATION']).toBe(1);
    expect(telemetry.bySource['PLAYGROUND']).toBe(1);
  });

  it('6. evaluates workspace usage metering and plan limit consumption status', async () => {
    const ws = await createWorkspaceFixture({ name: 'Usage Store' });

    // Seed usage counters for current month
    const periodKey = '2026-08';
    await prisma.usageCounter.createMany({
      data: [
        {
          workspaceId: ws.workspaceId,
          metric: 'AI_REQUEST',
          periodKey,
          quantity: 45,
        },
        {
          workspaceId: ws.workspaceId,
          metric: 'WHATSAPP_MESSAGE_SENT',
          periodKey,
          quantity: 120,
        },
      ],
    });

    const usageStatus = await getWorkspaceUsageAndLimits(ws.context, periodKey);

    expect(usageStatus.planKey).toBe('free');
    expect(usageStatus.periodKey).toBe('2026-08');

    // Free plan has 100 aiRequestsPerMonth limit
    expect(usageStatus.limits.aiRequestsPerMonth.limit).toBe(100);
    expect(usageStatus.limits.aiRequestsPerMonth.used).toBe(45);
    expect(usageStatus.limits.aiRequestsPerMonth.remaining).toBe(55);
    expect(usageStatus.limits.aiRequestsPerMonth.ratio).toBe(0.45);
    expect(usageStatus.limits.aiRequestsPerMonth.nearLimit).toBe(false);

    // Free plan has 300 messagesPerMonth limit
    expect(usageStatus.limits.messagesPerMonth.limit).toBe(300);
    expect(usageStatus.limits.messagesPerMonth.used).toBe(120);
    expect(usageStatus.limits.messagesPerMonth.remaining).toBe(180);
  });
});
