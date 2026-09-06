/**
 * Unit Tests for Revenue Intelligence V1.
 *
 * Validates:
 * - Authoritative revenue calculation (qualifying states, excluding cancelled/refunded)
 * - Conversation-to-order attribution (honest correlation, no fake causality)
 * - Customer drop-off / unconverted conversation signals
 * - Product demand aggregation and ranking
 * - AI operational outcomes and action approvals
 * - Period-over-period trend analysis and division-by-zero protection
 * - Strict multi-tenant isolation
 * - Data minimization and privacy
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TenantContext } from '@/server/tenancy/context';
import {
  getRevenueIntelligenceSummary,
  getRevenueIntelligenceTrends,
  getRevenueTimeSeries,
} from '@/server/repositories/revenue-intelligence.repository';
import {
  getRevenueIntelligence,
  resolveComparisonRange,
} from '@/server/services/analytics/revenue-intelligence.service';

describe('Revenue Intelligence V1', () => {
  const workspaceId = 'ws-test-1111-2222-3333-444444444444';
  const otherWorkspaceId = 'ws-test-9999-8888-7777-666666666666';

  const mockContext: TenantContext = {
    workspaceId,
    workspaceSlug: 'test-apparel-store',
    workspaceName: 'Test Apparel Store',
    membershipId: 'mem-123',
    sessionId: 'session-123',
    role: 'ADMIN',
    currency: 'PKR',
    planKey: 'FREE',
    onboarding: { completedSteps: [], completedAt: null },
    requestId: 'req-123',
    user: {
      id: 'usr-123',
      name: 'Store Owner',
      email: 'owner@test.com',
      avatarUrl: null,
      emailVerifiedAt: null,
    },
  };

  const fromDate = new Date('2026-08-01T00:00:00Z');
  const toDate = new Date('2026-08-31T23:59:59Z');

  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      order: {
        count: vi.fn(),
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      orderItem: {
        groupBy: vi.fn(),
      },
      conversation: {
        count: vi.fn(),
        findMany: vi.fn(),
        groupBy: vi.fn(),
      },
      aITurn: {
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      actionApproval: {
        count: vi.fn(),
        groupBy: vi.fn(),
      },
    };
  });

  describe('Scenario 1 — Authoritative Revenue & Qualification Rules', () => {
    it('calculates realized paid revenue and booked revenue strictly from qualifying orders', async () => {
      // 5 qualifying orders total:
      // 3 paid (total 15,000 PKR = 1,500,000 minor)
      // 2 booked unpaid COD (total 10,000 PKR = 1,000,000 minor)
      // Total booked = 2,500,000 minor across 5 orders

      mockDb.order.count.mockResolvedValue(5); // total orders

      mockDb.order.aggregate
        // 1. booked orders agg
        .mockResolvedValueOnce({
          _count: { id: 5 },
          _sum: { totalMinor: 2500000 },
        })
        // 2. paid orders agg
        .mockResolvedValueOnce({
          _count: { id: 3 },
          _sum: { totalMinor: 1500000 },
        })
        // 3. cancelled orders agg
        .mockResolvedValueOnce({
          _count: { id: 0 },
          _sum: { totalMinor: 0 },
        })
        // 4. direct chat orders agg
        .mockResolvedValueOnce({
          _count: { id: 2 },
          _sum: { totalMinor: 800000 },
        })
        // 5. ai-created orders agg
        .mockResolvedValueOnce({
          _count: { id: 2 },
          _sum: { totalMinor: 800000 },
        });

      mockDb.conversation.count.mockResolvedValue(10);
      mockDb.conversation.findMany.mockResolvedValue([
        { contactId: 'cust-1' },
        { contactId: 'cust-2' },
        { contactId: 'cust-3' },
      ]);
      mockDb.order.findMany
        .mockResolvedValueOnce([{ contactId: 'cust-1' }]) // ordering contacts
        .mockResolvedValueOnce([{ id: 'ord-1' }, { id: 'ord-2' }]); // qualifying order ids

      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(20);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      expect(summary.totalOrdersCount).toBe(5);
      expect(summary.bookedOrdersCount).toBe(5);
      expect(summary.bookedRevenueMinor).toBe(2500000);
      expect(summary.paidOrdersCount).toBe(3);
      expect(summary.paidRevenueMinor).toBe(1500000);
      expect(summary.cancelledOrdersCount).toBe(0);
      expect(summary.avgOrderValueMinor).toBe(500000); // 25,000 / 5 = 5,000 PKR
      expect(summary.paidAvgOrderValueMinor).toBe(500000); // 15,000 / 3 = 5,000 PKR
    });
  });

  describe('Scenario 2 — Cancelled Orders Handling', () => {
    it('strictly excludes cancelled orders from realized revenue and tracks them separately', async () => {
      mockDb.order.count.mockResolvedValue(3);

      mockDb.order.aggregate
        // booked orders (excludes cancelled)
        .mockResolvedValueOnce({
          _count: { id: 2 },
          _sum: { totalMinor: 1000000 },
        })
        // paid orders (excludes cancelled)
        .mockResolvedValueOnce({
          _count: { id: 1 },
          _sum: { totalMinor: 500000 },
        })
        // cancelled orders
        .mockResolvedValueOnce({
          _count: { id: 1 },
          _sum: { totalMinor: 400000 },
        })
        // direct chat orders
        .mockResolvedValueOnce({
          _count: { id: 1 },
          _sum: { totalMinor: 500000 },
        })
        // ai-created orders
        .mockResolvedValueOnce({
          _count: { id: 0 },
          _sum: { totalMinor: 0 },
        });

      mockDb.conversation.count.mockResolvedValue(5);
      mockDb.conversation.findMany.mockResolvedValue([{ contactId: 'cust-1' }]);
      mockDb.order.findMany
        .mockResolvedValueOnce([{ contactId: 'cust-1' }])
        .mockResolvedValueOnce([{ id: 'ord-1' }]);

      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(0);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      // Cancelled order is excluded from booked & paid revenue
      expect(summary.bookedOrdersCount).toBe(2);
      expect(summary.bookedRevenueMinor).toBe(1000000);
      expect(summary.paidRevenueMinor).toBe(500000);

      // Explicitly tracked as cancelled
      expect(summary.cancelledOrdersCount).toBe(1);
      expect(summary.cancelledRevenueMinor).toBe(400000);
    });
  });

  describe('Scenario 3 — Conversation Without Order (Drop-off Signal)', () => {
    it('tracks active conversations that did not produce an order without fabricating revenue', async () => {
      mockDb.order.count.mockResolvedValue(0);
      mockDb.order.aggregate
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } });

      // 4 active conversations with 3 distinct customers
      mockDb.conversation.count.mockResolvedValue(4);
      mockDb.conversation.findMany.mockResolvedValue([
        { contactId: 'cust-1' },
        { contactId: 'cust-2' },
        { contactId: 'cust-3' },
      ]);

      // 0 of them ordered
      mockDb.order.findMany
        .mockResolvedValueOnce([]) // ordering contacts = []
        .mockResolvedValueOnce([]); // qualifying orders = []

      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(12);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      expect(summary.totalConversations).toBe(4);
      expect(summary.activeChatCustomersCount).toBe(3);
      expect(summary.orderingChatCustomersCount).toBe(0);
      expect(summary.chatConversionRate).toBe(0);
      expect(summary.unconvertedChatCustomersCount).toBe(3);
      expect(summary.bookedRevenueMinor).toBe(0);
    });
  });

  describe('Scenario 4 — Customer With Multiple Conversations and One Order', () => {
    it('does not double count the customer or order across multiple conversations', async () => {
      mockDb.order.count.mockResolvedValue(1);
      mockDb.order.aggregate
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 300000 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 300000 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 300000 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 300000 } });

      // Customer 'cust-vip' had 3 separate conversations
      mockDb.conversation.count.mockResolvedValue(3);
      mockDb.conversation.findMany.mockResolvedValue([
        { contactId: 'cust-vip' },
      ]);

      // Distinct ordering contacts
      mockDb.order.findMany
        .mockResolvedValueOnce([{ contactId: 'cust-vip' }])
        .mockResolvedValueOnce([{ id: 'ord-1' }]);

      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(6);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      expect(summary.totalConversations).toBe(3);
      expect(summary.activeChatCustomersCount).toBe(1);
      expect(summary.orderingChatCustomersCount).toBe(1);
      expect(summary.chatConversionRate).toBe(100);
      expect(summary.unconvertedChatCustomersCount).toBe(0);
      expect(summary.bookedOrdersCount).toBe(1);
      expect(summary.bookedRevenueMinor).toBe(300000);
    });
  });

  describe('Scenario 5 — Product Demand Signals', () => {
    it('accurately ranks products by units sold and aggregates revenue', async () => {
      mockDb.order.count.mockResolvedValue(2);
      mockDb.order.aggregate
        .mockResolvedValueOnce({ _count: { id: 2 }, _sum: { totalMinor: 750000 } })
        .mockResolvedValueOnce({ _count: { id: 2 }, _sum: { totalMinor: 750000 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 2 }, _sum: { totalMinor: 750000 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 350000 } });

      mockDb.conversation.count.mockResolvedValue(2);
      mockDb.conversation.findMany.mockResolvedValue([{ contactId: 'c-1' }]);
      mockDb.order.findMany
        .mockResolvedValueOnce([{ contactId: 'c-1' }])
        .mockResolvedValueOnce([{ id: 'ord-1' }, { id: 'ord-2' }]);

      // Top products mock
      mockDb.orderItem.groupBy.mockResolvedValueOnce([
        {
          productId: 'prod-hoodie-black',
          nameSnapshot: 'Premium Oversized Hoodie (Black)',
          _sum: { quantity: 15, lineSubtotalMinor: 450000 },
          _count: { orderId: 8 },
        },
        {
          productId: 'prod-tee-white',
          nameSnapshot: 'Classic Cotton Tee (White)',
          _sum: { quantity: 10, lineSubtotalMinor: 300000 },
          _count: { orderId: 6 },
        },
      ]);

      mockDb.aITurn.count.mockResolvedValue(5);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      expect(summary.topProducts).toHaveLength(2);
      expect(summary.topProducts[0]?.name).toBe('Premium Oversized Hoodie (Black)');
      expect(summary.topProducts[0]?.unitsSold).toBe(15);
      expect(summary.topProducts[0]?.revenueMinor).toBe(450000);
      expect(summary.topProducts[0]?.orderCount).toBe(8);

      expect(summary.topProducts[1]?.name).toBe('Classic Cotton Tee (White)');
      expect(summary.topProducts[1]?.unitsSold).toBe(10);
    });
  });

  describe('Scenario 6 — AI Action Outcomes & Approvals', () => {
    it('aggregates grounding pass rates, handoff reasons, and action approvals', async () => {
      mockDb.order.count.mockResolvedValue(1);
      mockDb.order.aggregate
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 200000 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 200000 } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { totalMinor: 0 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 200000 } })
        .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { totalMinor: 200000 } });

      mockDb.conversation.count
        .mockResolvedValueOnce(20) // total conversations
        .mockResolvedValueOnce(4); // handoff count

      mockDb.conversation.findMany.mockResolvedValue([{ contactId: 'c-1' }]);
      mockDb.order.findMany
        .mockResolvedValueOnce([{ contactId: 'c-1' }])
        .mockResolvedValueOnce([{ id: 'ord-1' }]);

      mockDb.orderItem.groupBy.mockResolvedValue([]);

      // AI turns: 50 total, 45 passed, 5 blocked
      mockDb.aITurn.count
        .mockResolvedValueOnce(50) // total turns
        .mockResolvedValueOnce(45) // passed
        .mockResolvedValueOnce(5); // blocked

      mockDb.aITurn.groupBy.mockResolvedValueOnce([
        { blockedReason: 'UNSUPPORTED_DISCOUNT_CLAIM', _count: { id: 3 } },
        { blockedReason: 'UNSUPPORTED_POLICY_CLAIM', _count: { id: 2 } },
      ]);

      mockDb.conversation.groupBy.mockResolvedValueOnce([
        { handoffReason: 'CUSTOMER_REQUESTED', _count: { id: 3 } },
        { handoffReason: 'REFUND_REQUEST', _count: { id: 1 } },
      ]);

      // Approvals: 3 total, 2 approved, 1 rejected, 1 executed, 0 pending, 0 failed
      mockDb.actionApproval.count
        .mockResolvedValueOnce(3) // total
        .mockResolvedValueOnce(2) // approved
        .mockResolvedValueOnce(1) // rejected
        .mockResolvedValueOnce(1) // executed
        .mockResolvedValueOnce(0) // pending
        .mockResolvedValueOnce(0); // failed

      mockDb.actionApproval.groupBy.mockResolvedValueOnce([
        { actionType: 'ORDER_CANCEL', _count: { id: 2 } },
        { actionType: 'ADDRESS_CHANGE', _count: { id: 1 } },
      ]);

      const summary = await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      expect(summary.aiTurnsCount).toBe(50);
      expect(summary.groundingPassedCount).toBe(45);
      expect(summary.groundingBlockedCount).toBe(5);
      expect(summary.groundingPassRate).toBe(90); // 45/50 = 90%
      expect(summary.groundingBlockedReasons['UNSUPPORTED_DISCOUNT_CLAIM']).toBe(3);
      expect(summary.groundingBlockedReasons['UNSUPPORTED_POLICY_CLAIM']).toBe(2);

      expect(summary.handoffsCount).toBe(4);
      expect(summary.handoffReasons['CUSTOMER_REQUESTED']).toBe(3);
      expect(summary.handoffReasons['REFUND_REQUEST']).toBe(1);

      expect(summary.approvalsRequestedCount).toBe(3);
      expect(summary.approvalsApprovedCount).toBe(2);
      expect(summary.approvalsRejectedCount).toBe(1);
      expect(summary.approvalsExecutedCount).toBe(1);
      expect(summary.approvalsByType['ORDER_CANCEL']).toBe(2);
      expect(summary.approvalsByType['ADDRESS_CHANGE']).toBe(1);
    });
  });

  describe('Scenario 7 — Period-over-Period Trends & Division by Zero Protection', () => {
    it('safely computes percentage changes and protects against division by zero', async () => {
      // Setup mock to return different data for current vs previous
      // Current: 2,000,000 minor revenue, 4 orders
      // Previous: 1,000,000 minor revenue, 2 orders (100% increase)
      let callIndex = 0;
      mockDb.order.count.mockImplementation(async () => {
        callIndex++;
        return callIndex <= 1 ? 4 : 2;
      });

      mockDb.order.aggregate.mockImplementation(async () => {
        // Return 2,000,000 on current calls, 1,000,000 on previous calls
        if (callIndex <= 1) {
          return { _count: { id: 4 }, _sum: { totalMinor: 2000000 } };
        }
        return { _count: { id: 2 }, _sum: { totalMinor: 1000000 } };
      });

      mockDb.conversation.count.mockResolvedValue(10);
      mockDb.conversation.findMany.mockResolvedValue([{ contactId: 'c-1' }]);
      mockDb.order.findMany.mockResolvedValue([{ contactId: 'c-1' }, { id: 'ord-1' }]);
      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(0);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const previousFrom = new Date('2026-07-01T00:00:00Z');
      const previousTo = new Date('2026-07-31T23:59:59Z');

      const trends = await getRevenueIntelligenceTrends(
        mockDb,
        workspaceId,
        fromDate,
        toDate,
        previousFrom,
        previousTo,
      );

      expect(trends.bookedRevenue.current).toBe(2000000);
      expect(trends.bookedRevenue.previous).toBe(1000000);
      expect(trends.bookedRevenue.delta).toBe(1000000);
      expect(trends.bookedRevenue.percentageChange).toBe(100);
    });

    it('returns null or +100% when previous period has zero revenue', async () => {
      let aggregateCallCount = 0;
      mockDb.order.count.mockResolvedValue(1);
      mockDb.order.aggregate.mockImplementation(async () => {
        aggregateCallCount++;
        // First 5 calls are for current period
        if (aggregateCallCount <= 5) {
          return { _count: { id: 2 }, _sum: { totalMinor: 500000 } };
        }
        // Calls for previous period
        return { _count: { id: 0 }, _sum: { totalMinor: 0 } };
      });

      mockDb.conversation.count.mockResolvedValue(5);
      mockDb.conversation.findMany.mockResolvedValue([]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.orderItem.groupBy.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(0);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const previousFrom = new Date('2026-07-01T00:00:00Z');
      const previousTo = new Date('2026-07-31T23:59:59Z');

      const trends = await getRevenueIntelligenceTrends(
        mockDb,
        workspaceId,
        fromDate,
        toDate,
        previousFrom,
        previousTo,
      );

      // Previous was 0, current was 500,000 -> +100%
      expect(trends.bookedRevenue.previous).toBe(0);
      expect(trends.bookedRevenue.percentageChange).toBe(100);
    });
  });

  describe('Scenario 8 — Tenant Isolation & Privacy', () => {
    it('always restricts database queries strictly to the actor workspaceId', async () => {
      mockDb.order.count.mockResolvedValue(0);
      mockDb.order.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { totalMinor: 0 } });
      mockDb.conversation.count.mockResolvedValue(0);
      mockDb.conversation.findMany.mockResolvedValue([]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(0);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      await getRevenueIntelligenceSummary(mockDb, workspaceId, fromDate, toDate);

      // Verify all calls included workspaceId: workspaceId
      const orderCountCalls = mockDb.order.count.mock.calls;
      for (const call of orderCountCalls) {
        expect(call[0].where.workspaceId).toBe(workspaceId);
      }

      const conversationCountCalls = mockDb.conversation.count.mock.calls;
      for (const call of conversationCountCalls) {
        expect(call[0].where.workspaceId).toBe(workspaceId);
      }
    });

    it('never exposes private customer phone numbers or raw chat messages in report summary', async () => {
      mockDb.order.count.mockResolvedValue(0);
      mockDb.order.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { totalMinor: 0 } });
      mockDb.conversation.count.mockResolvedValue(0);
      mockDb.conversation.findMany.mockResolvedValue([]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.aITurn.count.mockResolvedValue(0);
      mockDb.aITurn.groupBy.mockResolvedValue([]);
      mockDb.conversation.groupBy.mockResolvedValue([]);
      mockDb.actionApproval.count.mockResolvedValue(0);
      mockDb.actionApproval.groupBy.mockResolvedValue([]);

      const report = await getRevenueIntelligence(mockContext, {
        from: fromDate,
        to: toDate,
      }, mockDb);

      const json = JSON.stringify(report);
      expect(json).not.toContain('phoneE164');
      expect(json).not.toContain('inputText');
      expect(json).not.toContain('outputText');
    });
  });

  describe('Scenario 9 — Date Range Resolution', () => {
    it('correctly resolves 7d, 30d, 90d, and equivalent comparison windows', () => {
      const range7d = resolveComparisonRange({ range: '7d' });
      expect(range7d.rangeKey).toBe('7d');
      expect(range7d.formattedRange).toBe('Last 7 days');
      const diff7d = range7d.to.getTime() - range7d.from.getTime();
      expect(diff7d).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);

      const prevDiff7d = range7d.previousTo.getTime() - range7d.previousFrom.getTime();
      expect(prevDiff7d).toBe(diff7d);

      const range30d = resolveComparisonRange({ range: '30d' });
      expect(range30d.rangeKey).toBe('30d');
      expect(range30d.formattedRange).toBe('Last 30 days');

      const range90d = resolveComparisonRange({ range: '90d' });
      expect(range90d.rangeKey).toBe('90d');
      expect(range90d.formattedRange).toBe('Last 90 days');
    });
  });

  describe('Scenario 10 — Revenue Time Series Generation', () => {
    it('generates a continuous sorted daily time-series with zero-fill for quiet days', async () => {
      mockDb.order.findMany.mockResolvedValue([
        {
          id: 'o-1',
          totalMinor: 500000,
          status: 'DELIVERED',
          paymentStatus: 'PAID',
          conversationId: 'c-1',
          createdAt: new Date('2026-08-15T10:00:00Z'),
        },
      ]);

      mockDb.conversation.findMany.mockResolvedValue([
        {
          id: 'c-1',
          createdAt: new Date('2026-08-15T09:00:00Z'),
        },
        {
          id: 'c-2',
          createdAt: new Date('2026-08-16T11:00:00Z'),
        },
      ]);

      const series = await getRevenueTimeSeries(
        mockDb,
        workspaceId,
        new Date('2026-08-14T00:00:00Z'),
        new Date('2026-08-16T23:59:59Z'),
      );

      expect(series).toHaveLength(3); // Aug 14, 15, 16
      expect(series[0]?.date).toBe('2026-08-14');
      expect(series[0]?.bookedRevenueMinor).toBe(0);

      expect(series[1]?.date).toBe('2026-08-15');
      expect(series[1]?.bookedRevenueMinor).toBe(500000);
      expect(series[1]?.paidRevenueMinor).toBe(500000);
      expect(series[1]?.chatRevenueMinor).toBe(500000);
      expect(series[1]?.ordersCount).toBe(1);
      expect(series[1]?.conversationsCount).toBe(1);

      expect(series[2]?.date).toBe('2026-08-16');
      expect(series[2]?.bookedRevenueMinor).toBe(0);
      expect(series[2]?.conversationsCount).toBe(1);
    });
  });
});
