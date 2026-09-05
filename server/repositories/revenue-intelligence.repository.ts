/**
 * Revenue Intelligence Repository.
 *
 * Implements workspace-scoped database queries for revenue analysis,
 * conversation-to-order attribution, product demand signals, AI action outcomes,
 * and period-over-period trend comparisons.
 *
 * Source of truth: authoritative Order, OrderItem, Conversation, Contact,
 * AITurn, and ActionApproval database records.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export interface TopProductDemand {
  productId: string | null;
  name: string;
  unitsSold: number;
  revenueMinor: number;
  orderCount: number;
}

export interface RevenueIntelligenceSummary {
  // Sales & Revenue (Authoritative Domain Records)
  totalOrdersCount: number;
  bookedOrdersCount: number;
  bookedRevenueMinor: number;
  paidOrdersCount: number;
  paidRevenueMinor: number;
  cancelledOrdersCount: number;
  cancelledRevenueMinor: number;
  avgOrderValueMinor: number;
  paidAvgOrderValueMinor: number;

  // Conversation & Chat Attribution (Honest, Non-Causal Framing)
  totalConversations: number;
  activeChatCustomersCount: number;
  orderingChatCustomersCount: number;
  chatConversionRate: number; // Percentage (e.g. 15.5%)
  unconvertedChatCustomersCount: number;
  directChatOrdersCount: number;
  directChatRevenueMinor: number;
  aiCreatedOrdersCount: number;
  aiCreatedRevenueMinor: number;

  // Product Demand Signals
  topProducts: TopProductDemand[];

  // AI & Action Outcomes
  aiTurnsCount: number;
  groundingPassedCount: number;
  groundingBlockedCount: number;
  groundingPassRate: number; // Percentage
  groundingBlockedReasons: Record<string, number>;
  handoffsCount: number;
  handoffReasons: Record<string, number>;

  // Action Approvals
  approvalsRequestedCount: number;
  approvalsApprovedCount: number;
  approvalsRejectedCount: number;
  approvalsExecutedCount: number;
  approvalsPendingCount: number;
  approvalsFailedCount: number;
  approvalsByType: Record<string, number>;
}

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  percentageChange: number | null;
}

export interface RevenueIntelligenceTrends {
  bookedRevenue: MetricTrend;
  paidRevenue: MetricTrend;
  bookedOrders: MetricTrend;
  conversations: MetricTrend;
  chatCustomers: MetricTrend;
  directChatRevenue: MetricTrend;
  aiCreatedRevenue: MetricTrend;
  avgOrderValue: MetricTrend;
}

export interface RevenueDailyPoint {
  date: string; // YYYY-MM-DD
  bookedRevenueMinor: number;
  paidRevenueMinor: number;
  chatRevenueMinor: number;
  ordersCount: number;
  chatOrdersCount: number;
  conversationsCount: number;
}

/**
 * Calculates summary metrics for the given workspace and time window.
 */
export async function getRevenueIntelligenceSummary(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
): Promise<RevenueIntelligenceSummary> {
  const [
    // Orders
    totalOrdersCount,
    bookedOrdersAgg,
    paidOrdersAgg,
    cancelledOrdersAgg,
    directChatOrdersAgg,
    aiCreatedOrdersAgg,

    // Conversations
    totalConversations,
    activeChatContactsRows,

    // AI Turns & Grounding
    aiTurnsCount,
    groundingPassedCount,
    groundingBlockedCount,
    groundingBlockedRows,

    // Handoffs
    handoffsCount,
    handoffReasonsRows,

    // Action Approvals
    approvalsRequestedCount,
    approvalsApprovedCount,
    approvalsRejectedCount,
    approvalsExecutedCount,
    approvalsPendingCount,
    approvalsFailedCount,
    approvalsByTypeRows,
  ] = await Promise.all([
    // 1. Total orders placed in window
    db.order.count({
      where: {
        workspaceId,
        deletedAt: null,
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 2. Booked (valid, non-cancelled) orders
    db.order.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
      _sum: { totalMinor: true },
    }),

    // 3. Paid orders
    db.order.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
      _sum: { totalMinor: true },
    }),

    // 4. Cancelled orders
    db.order.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        status: 'CANCELLED',
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
      _sum: { totalMinor: true },
    }),

    // 5. Direct chat orders (associated with a conversation)
    db.order.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        conversationId: { not: null },
        status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
      _sum: { totalMinor: true },
    }),

    // 6. AI-created orders
    db.order.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        createdByAi: true,
        status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
      _sum: { totalMinor: true },
    }),

    // 7. Conversations active in period
    db.conversation.count({
      where: {
        workspaceId,
        OR: [
          { createdAt: { gte: fromDate, lte: toDate } },
          { lastMessageAt: { gte: fromDate, lte: toDate } },
        ],
      },
    }),

    // 8. Distinct contacts who had conversation activity in period
    db.conversation.findMany({
      where: {
        workspaceId,
        OR: [
          { createdAt: { gte: fromDate, lte: toDate } },
          { lastMessageAt: { gte: fromDate, lte: toDate } },
        ],
      },
      select: { contactId: true },
      distinct: ['contactId'],
    }),

    // 9. AI Turns
    db.aITurn.count({
      where: {
        workspaceId,
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 10. Grounding passed
    db.aITurn.count({
      where: {
        workspaceId,
        groundingPassed: true,
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 11. Grounding blocked
    db.aITurn.count({
      where: {
        workspaceId,
        groundingPassed: false,
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 12. Grounding blocked reasons
    db.aITurn.groupBy({
      by: ['blockedReason'],
      where: {
        workspaceId,
        groundingPassed: false,
        blockedReason: { not: null },
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
    }),

    // 13. Handoff count
    db.conversation.count({
      where: {
        workspaceId,
        handoffAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 14. Handoff reasons
    db.conversation.groupBy({
      by: ['handoffReason'],
      where: {
        workspaceId,
        handoffReason: { not: null },
        handoffAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
    }),

    // 15. Approvals: total
    db.actionApproval.count({
      where: {
        workspaceId,
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 16. Approvals: approved
    db.actionApproval.count({
      where: {
        workspaceId,
        status: 'APPROVED',
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 17. Approvals: rejected
    db.actionApproval.count({
      where: {
        workspaceId,
        status: 'REJECTED',
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 18. Approvals: executed
    db.actionApproval.count({
      where: {
        workspaceId,
        status: 'EXECUTED',
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 19. Approvals: pending
    db.actionApproval.count({
      where: {
        workspaceId,
        status: 'PENDING',
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 20. Approvals: failed
    db.actionApproval.count({
      where: {
        workspaceId,
        status: 'FAILED',
        createdAt: { gte: fromDate, lte: toDate },
      },
    }),

    // 21. Approvals by actionType
    db.actionApproval.groupBy({
      by: ['actionType'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate, lte: toDate },
      },
      _count: { id: true },
    }),
  ]);

  // Derive conversation conversion
  const activeChatContactIds = activeChatContactsRows.map((r) => r.contactId);
  let orderingChatCustomersCount = 0;

  if (activeChatContactIds.length > 0) {
    const orderingContacts = await db.order.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
        contactId: { in: activeChatContactIds },
        createdAt: { gte: fromDate, lte: toDate },
      },
      select: { contactId: true },
      distinct: ['contactId'],
    });
    orderingChatCustomersCount = orderingContacts.length;
  }

  const activeChatCustomersCount = activeChatContactIds.length;
  const chatConversionRate =
    activeChatCustomersCount > 0
      ? Math.round((orderingChatCustomersCount / activeChatCustomersCount) * 1000) / 10
      : 0;
  const unconvertedChatCustomersCount = Math.max(
    0,
    activeChatCustomersCount - orderingChatCustomersCount,
  );

  // Derive Product Demand Signals
  // Find qualifying orders in period
  const qualifyingOrders = await db.order.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
      createdAt: { gte: fromDate, lte: toDate },
    },
    select: { id: true },
    take: 1000,
  });

  const qualifyingOrderIds = qualifyingOrders.map((o) => o.id);
  let topProducts: TopProductDemand[] = [];

  if (qualifyingOrderIds.length > 0) {
    const itemAggs = await db.orderItem.groupBy({
      by: ['productId', 'nameSnapshot'],
      where: {
        workspaceId,
        orderId: { in: qualifyingOrderIds },
      },
      _sum: {
        quantity: true,
        lineSubtotalMinor: true,
      },
      _count: {
        orderId: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: 5,
    });

    topProducts = itemAggs.map((item) => ({
      productId: item.productId,
      name: item.nameSnapshot,
      unitsSold: item._sum.quantity ?? 0,
      revenueMinor: item._sum.lineSubtotalMinor ?? 0,
      orderCount: item._count.orderId,
    }));
  }

  // Calculate averages
  const bookedOrdersCount = bookedOrdersAgg._count.id;
  const bookedRevenueMinor = bookedOrdersAgg._sum.totalMinor ?? 0;
  const paidOrdersCount = paidOrdersAgg._count.id;
  const paidRevenueMinor = paidOrdersAgg._sum.totalMinor ?? 0;
  const cancelledOrdersCount = cancelledOrdersAgg._count.id;
  const cancelledRevenueMinor = cancelledOrdersAgg._sum.totalMinor ?? 0;

  const avgOrderValueMinor =
    bookedOrdersCount > 0 ? Math.round(bookedRevenueMinor / bookedOrdersCount) : 0;
  const paidAvgOrderValueMinor =
    paidOrdersCount > 0 ? Math.round(paidRevenueMinor / paidOrdersCount) : 0;

  const groundingPassRate =
    aiTurnsCount > 0 ? Math.round((groundingPassedCount / aiTurnsCount) * 1000) / 10 : 100;

  // Format breakdowns
  const groundingBlockedReasons: Record<string, number> = {};
  for (const row of groundingBlockedRows) {
    if (row.blockedReason) {
      groundingBlockedReasons[row.blockedReason] = row._count.id;
    }
  }

  const handoffReasons: Record<string, number> = {};
  for (const row of handoffReasonsRows) {
    if (row.handoffReason) {
      handoffReasons[row.handoffReason] = row._count.id;
    }
  }

  const approvalsByType: Record<string, number> = {};
  for (const row of approvalsByTypeRows) {
    approvalsByType[row.actionType] = row._count.id;
  }

  return {
    totalOrdersCount,
    bookedOrdersCount,
    bookedRevenueMinor,
    paidOrdersCount,
    paidRevenueMinor,
    cancelledOrdersCount,
    cancelledRevenueMinor,
    avgOrderValueMinor,
    paidAvgOrderValueMinor,

    totalConversations,
    activeChatCustomersCount,
    orderingChatCustomersCount,
    chatConversionRate,
    unconvertedChatCustomersCount,
    directChatOrdersCount: directChatOrdersAgg._count.id,
    directChatRevenueMinor: directChatOrdersAgg._sum.totalMinor ?? 0,
    aiCreatedOrdersCount: aiCreatedOrdersAgg._count.id,
    aiCreatedRevenueMinor: aiCreatedOrdersAgg._sum.totalMinor ?? 0,

    topProducts,

    aiTurnsCount,
    groundingPassedCount,
    groundingBlockedCount,
    groundingPassRate,
    groundingBlockedReasons,
    handoffsCount,
    handoffReasons,

    approvalsRequestedCount,
    approvalsApprovedCount,
    approvalsRejectedCount,
    approvalsExecutedCount,
    approvalsPendingCount,
    approvalsFailedCount,
    approvalsByType,
  };
}

/**
 * Computes period-over-period trend deltas between current and previous equivalent windows.
 */
export async function getRevenueIntelligenceTrends(
  db: Db,
  workspaceId: string,
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date,
): Promise<RevenueIntelligenceTrends> {
  const [current, previous] = await Promise.all([
    getRevenueIntelligenceSummary(db, workspaceId, currentFrom, currentTo),
    getRevenueIntelligenceSummary(db, workspaceId, previousFrom, previousTo),
  ]);

  const computeDelta = (curr: number, prev: number): MetricTrend => {
    const delta = curr - prev;
    let percentageChange: number | null = null;
    if (prev > 0) {
      percentageChange = Math.round((delta / prev) * 1000) / 10;
    } else if (prev === 0 && curr > 0) {
      percentageChange = 100;
    } else if (prev === 0 && curr === 0) {
      percentageChange = 0;
    }
    return {
      current: curr,
      previous: prev,
      delta,
      percentageChange,
    };
  };

  return {
    bookedRevenue: computeDelta(current.bookedRevenueMinor, previous.bookedRevenueMinor),
    paidRevenue: computeDelta(current.paidRevenueMinor, previous.paidRevenueMinor),
    bookedOrders: computeDelta(current.bookedOrdersCount, previous.bookedOrdersCount),
    conversations: computeDelta(current.totalConversations, previous.totalConversations),
    chatCustomers: computeDelta(current.activeChatCustomersCount, previous.activeChatCustomersCount),
    directChatRevenue: computeDelta(current.directChatRevenueMinor, previous.directChatRevenueMinor),
    aiCreatedRevenue: computeDelta(current.aiCreatedRevenueMinor, previous.aiCreatedRevenueMinor),
    avgOrderValue: computeDelta(current.avgOrderValueMinor, previous.avgOrderValueMinor),
  };
}

/**
 * Returns daily revenue and conversation time-series data for trend visualization.
 */
export async function getRevenueTimeSeries(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
): Promise<RevenueDailyPoint[]> {
  // 1. Fetch daily qualifying orders
  const orders = await db.order.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      createdAt: { gte: fromDate, lte: toDate },
    },
    select: {
      id: true,
      totalMinor: true,
      status: true,
      paymentStatus: true,
      conversationId: true,
      createdAt: true,
    },
  });

  // 2. Fetch daily conversations
  const conversations = await db.conversation.findMany({
    where: {
      workspaceId,
      createdAt: { gte: fromDate, lte: toDate },
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  // 3. Build continuous date map
  const dateMap = new Map<string, RevenueDailyPoint>();
  const curr = new Date(fromDate);
  curr.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(23, 59, 59, 999);

  while (curr <= end) {
    const key = curr.toISOString().slice(0, 10);
    if (!dateMap.has(key)) {
      dateMap.set(key, {
        date: key,
        bookedRevenueMinor: 0,
        paidRevenueMinor: 0,
        chatRevenueMinor: 0,
        ordersCount: 0,
        chatOrdersCount: 0,
        conversationsCount: 0,
      });
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  // 4. Aggregate orders into dates
  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const point = dateMap.get(key);
    if (!point) continue;

    const isCancelledOrDraft =
      order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.status === 'DRAFT';

    if (!isCancelledOrDraft) {
      point.bookedRevenueMinor += order.totalMinor;
      point.ordersCount += 1;

      if (order.conversationId) {
        point.chatRevenueMinor += order.totalMinor;
        point.chatOrdersCount += 1;
      }
    }

    if (order.paymentStatus === 'PAID' && order.status !== 'CANCELLED') {
      point.paidRevenueMinor += order.totalMinor;
    }
  }

  // 5. Aggregate conversations into dates
  for (const conv of conversations) {
    const key = conv.createdAt.toISOString().slice(0, 10);
    const point = dateMap.get(key);
    if (!point) continue;
    point.conversationsCount += 1;
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}
