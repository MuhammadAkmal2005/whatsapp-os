/**
 * Analytics Repository.
 *
 * Provides workspace-scoped multi-dimensional data aggregation, time-series metrics,
 * AI cost attribution, usage metering ledgers, and daily rollups.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { UsageMetric } from '@prisma/client';

export type WorkspaceAnalyticsSummary = {
  // Messaging
  messagesIn: number;
  messagesOut: number;
  totalMessages: number;
  conversationsNew: number;
  conversationsResolved: number;
  conversationsTotal: number;
  conversationsOpen: number;
  avgFirstResponseMs: number | null;
  avgResolutionMs: number | null;

  // AI Telemetry
  aiHandledConversations: number;
  handoffCount: number;
  aiRequests: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiCostMicros: number;
  groundingPassedCount: number;
  groundingBlockedCount: number;

  // Commerce
  ordersCount: number;
  paidOrdersCount: number;
  revenueMinor: number;
  avgOrderValueMinor: number;
  aiOrdersCount: number;
  aiRevenueMinor: number;

  // Contacts
  contactsNew: number;
  leadsNew: number;
  contactsTotal: number;
};

export type TimeSeriesDataPoint = {
  date: string; // YYYY-MM-DD
  messagesIn: number;
  messagesOut: number;
  conversationsNew: number;
  ordersCount: number;
  revenueMinor: number;
  aiRequests: number;
  aiCostMicros: number;
  contactsNew: number;
};

export type ModelUsageBreakdown = {
  model: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  avgLatencyMs: number;
};

export type AITelemetryBreakdown = {
  totalRequests: number;
  totalCostMicros: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  groundingPassRate: number;
  byModel: ModelUsageBreakdown[];
  bySource: Record<string, number>;
  byHandoffReason: Record<string, number>;
  byBlockedReason: Record<string, number>;
};

export type UsageMetricSummary = {
  metric: UsageMetric;
  quantity: number;
  costMicros: number;
};

/**
 * Aggregates core workspace analytics across a given time window.
 */
export async function getWorkspaceAnalyticsSummary(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
): Promise<WorkspaceAnalyticsSummary> {
  const [
    messagesIn,
    messagesOut,
    conversationsNew,
    conversationsResolved,
    conversationsTotal,
    conversationsOpen,
    aiHandledConversations,
    handoffCount,
    aiRequests,
    aiTokensAgg,
    groundingPassedCount,
    groundingBlockedCount,
    ordersCount,
    paidOrdersCount,
    revenueAgg,
    aiOrdersCount,
    aiRevenueAgg,
    contactsNew,
    leadsNew,
    contactsTotal,
    firstResponseConvRows,
    resolutionConvRows,
  ] = await Promise.all([
    // Messages
    db.message.count({
      where: { workspaceId, direction: 'INBOUND', occurredAt: { gte: fromDate, lte: toDate } },
    }),
    db.message.count({
      where: { workspaceId, direction: 'OUTBOUND', occurredAt: { gte: fromDate, lte: toDate } },
    }),
    // Conversations
    db.conversation.count({
      where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.conversation.count({
      where: { workspaceId, resolvedAt: { gte: fromDate, lte: toDate } },
    }),
    db.conversation.count({ where: { workspaceId } }),
    db.conversation.count({ where: { workspaceId, status: 'OPEN' } }),
    // AI
    db.conversation.count({
      where: { workspaceId, aiEnabled: true, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.conversation.count({
      where: { workspaceId, handoffAt: { gte: fromDate, lte: toDate } },
    }),
    db.aITurn.count({
      where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.aITurn.aggregate({
      where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
    db.aITurn.count({
      where: { workspaceId, groundingPassed: true, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.aITurn.count({
      where: { workspaceId, groundingPassed: false, createdAt: { gte: fromDate, lte: toDate } },
    }),
    // Orders
    db.order.count({
      where: { workspaceId, deletedAt: null, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.order.count({
      where: { workspaceId, deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.order.aggregate({
      where: { workspaceId, deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: fromDate, lte: toDate } },
      _sum: { totalMinor: true },
    }),
    db.order.count({
      where: { workspaceId, deletedAt: null, createdByAi: true, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.order.aggregate({
      where: { workspaceId, deletedAt: null, createdByAi: true, paymentStatus: 'PAID', createdAt: { gte: fromDate, lte: toDate } },
      _sum: { totalMinor: true },
    }),
    // Contacts
    db.contact.count({
      where: { workspaceId, deletedAt: null, createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.contact.count({
      where: { workspaceId, deletedAt: null, status: 'LEAD', createdAt: { gte: fromDate, lte: toDate } },
    }),
    db.contact.count({ where: { workspaceId, deletedAt: null } }),
    // First response time calculation
    db.conversation.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate, lte: toDate },
        firstResponseAt: { not: null },
      },
      select: { createdAt: true, firstResponseAt: true },
      take: 200,
    }),
    // Resolution time calculation
    db.conversation.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate, lte: toDate },
        resolvedAt: { not: null },
      },
      select: { createdAt: true, resolvedAt: true },
      take: 200,
    }),
  ]);

  // Compute average first response time
  let avgFirstResponseMs: number | null = null;
  if (firstResponseConvRows.length > 0) {
    const totalDiffMs = firstResponseConvRows.reduce((acc, row) => {
      if (row.firstResponseAt) {
        const diff = row.firstResponseAt.getTime() - row.createdAt.getTime();
        return acc + Math.max(0, diff);
      }
      return acc;
    }, 0);
    avgFirstResponseMs = Math.round(totalDiffMs / firstResponseConvRows.length);
  }

  // Compute average resolution time
  let avgResolutionMs: number | null = null;
  if (resolutionConvRows.length > 0) {
    const totalResMs = resolutionConvRows.reduce((acc, row) => {
      if (row.resolvedAt) {
        const diff = row.resolvedAt.getTime() - row.createdAt.getTime();
        return acc + Math.max(0, diff);
      }
      return acc;
    }, 0);
    avgResolutionMs = Math.round(totalResMs / resolutionConvRows.length);
  }

  const revenueMinor = revenueAgg._sum.totalMinor ?? 0;
  const avgOrderValueMinor = paidOrdersCount > 0 ? Math.round(revenueMinor / paidOrdersCount) : 0;
  const inputTokens = aiTokensAgg._sum.inputTokens ?? 0;
  const outputTokens = aiTokensAgg._sum.outputTokens ?? 0;

  return {
    messagesIn,
    messagesOut,
    totalMessages: messagesIn + messagesOut,
    conversationsNew,
    conversationsResolved,
    conversationsTotal,
    conversationsOpen,
    avgFirstResponseMs,
    avgResolutionMs,

    aiHandledConversations,
    handoffCount,
    aiRequests,
    aiInputTokens: inputTokens,
    aiOutputTokens: outputTokens,
    aiTotalTokens: inputTokens + outputTokens,
    aiCostMicros: aiTokensAgg._sum.costMicros ?? 0,
    groundingPassedCount,
    groundingBlockedCount,

    ordersCount,
    paidOrdersCount,
    revenueMinor,
    avgOrderValueMinor,
    aiOrdersCount,
    aiRevenueMinor: aiRevenueAgg._sum.totalMinor ?? 0,

    contactsNew,
    leadsNew,
    contactsTotal,
  };
}

/**
 * Returns bucketed daily time series points within a date range for charting.
 */
export async function getAnalyticsTimeSeries(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
): Promise<TimeSeriesDataPoint[]> {
  // If pre-aggregated daily rollups exist, use them
  const rollups = await db.analyticsDaily.findMany({
    where: {
      workspaceId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: 'asc' },
  });

  const rollupMap = new Map<string, (typeof rollups)[0]>();
  for (const r of rollups) {
    const dateKey = r.date.toISOString().split('T')[0]!;
    rollupMap.set(dateKey, r);
  }

  // Generate sequence of dates from fromDate to toDate
  const result: TimeSeriesDataPoint[] = [];
  const current = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());

  while (current <= end) {
    const dateKey = current.toISOString().split('T')[0]!;
    const rollup = rollupMap.get(dateKey);

    if (rollup) {
      result.push({
        date: dateKey,
        messagesIn: rollup.messagesIn,
        messagesOut: rollup.messagesOut,
        conversationsNew: rollup.conversationsNew,
        ordersCount: rollup.ordersCount,
        revenueMinor: rollup.revenueMinor,
        aiRequests: rollup.aiRequests,
        aiCostMicros: rollup.aiCostMicros,
        contactsNew: rollup.contactsNew,
      });
    } else {
      // Real-time calculation for this single day
      const dayStart = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate(), 0, 0, 0, 0));
      const dayEnd = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59, 999));

      const [
        messagesIn,
        messagesOut,
        conversationsNew,
        ordersCount,
        revenueAgg,
        aiRequests,
        aiCostAgg,
        contactsNew,
      ] = await Promise.all([
        db.message.count({ where: { workspaceId, direction: 'INBOUND', occurredAt: { gte: dayStart, lte: dayEnd } } }),
        db.message.count({ where: { workspaceId, direction: 'OUTBOUND', occurredAt: { gte: dayStart, lte: dayEnd } } }),
        db.conversation.count({ where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } } }),
        db.order.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: dayStart, lte: dayEnd } } }),
        db.order.aggregate({
          where: { workspaceId, deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: dayStart, lte: dayEnd } },
          _sum: { totalMinor: true },
        }),
        db.aITurn.count({ where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } } }),
        db.aITurn.aggregate({
          where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } },
          _sum: { costMicros: true },
        }),
        db.contact.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: dayStart, lte: dayEnd } } }),
      ]);

      result.push({
        date: dateKey,
        messagesIn,
        messagesOut,
        conversationsNew,
        ordersCount,
        revenueMinor: revenueAgg._sum.totalMinor ?? 0,
        aiRequests,
        aiCostMicros: aiCostAgg._sum.costMicros ?? 0,
        contactsNew,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Returns multi-dimensional breakdown of AI usage, models, token consumption, and cost attribution.
 */
export async function getAIUsageAndCostBreakdown(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
  filters: { agentId?: string; model?: string; source?: string } = {},
): Promise<AITelemetryBreakdown> {
  const whereClause: Record<string, unknown> = {
    workspaceId,
    createdAt: { gte: fromDate, lte: toDate },
  };

  if (filters.agentId) whereClause.agentId = filters.agentId;
  if (filters.model) whereClause.model = filters.model;
  if (filters.source) whereClause.source = filters.source;

  const turns = await db.aITurn.findMany({
    where: whereClause,
    select: {
      model: true,
      provider: true,
      source: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
      latencyMs: true,
      groundingPassed: true,
      blockedReason: true,
      handoffTriggered: true,
      handoffReason: true,
    },
  });

  let totalRequests = turns.length;
  let totalCostMicros = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let groundingPassedCount = 0;

  const modelMap = new Map<string, {
    model: string;
    provider: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    totalLatencyMs: number;
  }>();

  const bySource: Record<string, number> = {};
  const byHandoffReason: Record<string, number> = {};
  const byBlockedReason: Record<string, number> = {};

  for (const turn of turns) {
    totalCostMicros += turn.costMicros;
    totalInputTokens += turn.inputTokens;
    totalOutputTokens += turn.outputTokens;
    if (turn.groundingPassed) groundingPassedCount++;

    // By model
    const key = `${turn.provider}:${turn.model}`;
    const existing = modelMap.get(key) ?? {
      model: turn.model,
      provider: turn.provider,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      totalLatencyMs: 0,
    };
    existing.requests += 1;
    existing.inputTokens += turn.inputTokens;
    existing.outputTokens += turn.outputTokens;
    existing.costMicros += turn.costMicros;
    existing.totalLatencyMs += turn.latencyMs;
    modelMap.set(key, existing);

    // By source
    bySource[turn.source] = (bySource[turn.source] ?? 0) + 1;

    // By handoff reason
    if (turn.handoffTriggered && turn.handoffReason) {
      byHandoffReason[turn.handoffReason] = (byHandoffReason[turn.handoffReason] ?? 0) + 1;
    }

    // By blocked reason
    if (!turn.groundingPassed && turn.blockedReason) {
      byBlockedReason[turn.blockedReason] = (byBlockedReason[turn.blockedReason] ?? 0) + 1;
    }
  }

  const byModel: ModelUsageBreakdown[] = Array.from(modelMap.values()).map((m) => ({
    model: m.model,
    provider: m.provider,
    requests: m.requests,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    totalTokens: m.inputTokens + m.outputTokens,
    costMicros: m.costMicros,
    avgLatencyMs: m.requests > 0 ? Math.round(m.totalLatencyMs / m.requests) : 0,
  }));

  const groundingPassRate = totalRequests > 0 ? Math.round((groundingPassedCount / totalRequests) * 100) : 100;

  return {
    totalRequests,
    totalCostMicros,
    totalInputTokens,
    totalOutputTokens,
    groundingPassRate,
    byModel,
    bySource,
    byHandoffReason,
    byBlockedReason,
  };
}

/**
 * Summarizes usage counters and metered resource consumption for a workspace billing period.
 */
export async function getWorkspaceUsageMetering(
  db: Db,
  workspaceId: string,
  periodKey: string,
): Promise<UsageMetricSummary[]> {
  const counters = await db.usageCounter.findMany({
    where: { workspaceId, periodKey },
  });

  const counterMap = new Map<UsageMetric, number>();
  for (const c of counters) {
    counterMap.set(c.metric, c.quantity);
  }

  // Cost calculation from UsageRecord for the period
  const usageRecords = await db.usageRecord.groupBy({
    by: ['metric'],
    where: { workspaceId },
    _sum: { quantity: true, costMicros: true },
  });

  const metrics: UsageMetric[] = [
    'AI_REQUEST',
    'AI_INPUT_TOKENS',
    'AI_OUTPUT_TOKENS',
    'AI_EMBEDDING_TOKENS',
    'WHATSAPP_MESSAGE_SENT',
    'WHATSAPP_MEDIA_SENT',
    'CAMPAIGN_MESSAGE',
    'AUTOMATION_EXECUTION',
    'STORAGE_BYTES',
    'CONTACT_COUNT',
    'TEAM_MEMBER_COUNT',
  ];

  return metrics.map((metric) => {
    const countVal = counterMap.get(metric);
    const agg = usageRecords.find((r) => r.metric === metric);
    const quantity = countVal ?? agg?._sum.quantity ?? 0;
    const costMicros = agg?._sum.costMicros ?? 0;

    return {
      metric,
      quantity,
      costMicros,
    };
  });
}

/**
 * Computes and persists the daily rollup row in AnalyticsDaily for a single workspace and date.
 */
export async function computeDailyRollupForWorkspace(
  db: Db,
  workspaceId: string,
  date: Date,
): Promise<void> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

  const [
    messagesIn,
    messagesOut,
    conversationsNew,
    conversationsResolved,
    aiHandledCount,
    handoffCount,
    contactsNew,
    leadsNew,
    ordersCount,
    revenueAgg,
    aiRequests,
    aiCostAgg,
    firstResponseConvRows,
    resolutionConvRows,
  ] = await Promise.all([
    db.message.count({ where: { workspaceId, direction: 'INBOUND', occurredAt: { gte: dayStart, lte: dayEnd } } }),
    db.message.count({ where: { workspaceId, direction: 'OUTBOUND', occurredAt: { gte: dayStart, lte: dayEnd } } }),
    db.conversation.count({ where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.conversation.count({ where: { workspaceId, resolvedAt: { gte: dayStart, lte: dayEnd } } }),
    db.conversation.count({ where: { workspaceId, aiEnabled: true, createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.conversation.count({ where: { workspaceId, handoffAt: { gte: dayStart, lte: dayEnd } } }),
    db.contact.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.contact.count({ where: { workspaceId, deletedAt: null, status: 'LEAD', createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.order.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.order.aggregate({
      where: { workspaceId, deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { totalMinor: true },
    }),
    db.aITurn.count({ where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } } }),
    db.aITurn.aggregate({
      where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { costMicros: true },
    }),
    db.conversation.findMany({
      where: {
        workspaceId,
        createdAt: { gte: dayStart, lte: dayEnd },
        firstResponseAt: { not: null },
      },
      select: { createdAt: true, firstResponseAt: true },
    }),
    db.conversation.findMany({
      where: {
        workspaceId,
        createdAt: { gte: dayStart, lte: dayEnd },
        resolvedAt: { not: null },
      },
      select: { createdAt: true, resolvedAt: true },
    }),
  ]);

  let avgFirstResponseMs: number | null = null;
  if (firstResponseConvRows.length > 0) {
    const totalDiff = firstResponseConvRows.reduce((acc, r) => {
      if (r.firstResponseAt) {
        return acc + Math.max(0, r.firstResponseAt.getTime() - r.createdAt.getTime());
      }
      return acc;
    }, 0);
    avgFirstResponseMs = Math.round(totalDiff / firstResponseConvRows.length);
  }

  let avgResolutionMs: number | null = null;
  if (resolutionConvRows.length > 0) {
    const totalDiff = resolutionConvRows.reduce((acc, r) => {
      if (r.resolvedAt) {
        return acc + Math.max(0, r.resolvedAt.getTime() - r.createdAt.getTime());
      }
      return acc;
    }, 0);
    avgResolutionMs = Math.round(totalDiff / resolutionConvRows.length);
  }

  const revenueMinor = revenueAgg._sum.totalMinor ?? 0;
  const aiCostMicros = aiCostAgg._sum.costMicros ?? 0;

  await db.analyticsDaily.upsert({
    where: {
      workspaceId_date: {
        workspaceId,
        date: dayStart,
      },
    },
    create: {
      workspaceId,
      date: dayStart,
      messagesIn,
      messagesOut,
      conversationsNew,
      conversationsResolved,
      aiHandledCount,
      handoffCount,
      contactsNew,
      leadsNew,
      ordersCount,
      revenueMinor,
      aiRequests,
      aiCostMicros,
      avgFirstResponseMs,
      avgResolutionMs,
    },
    update: {
      messagesIn,
      messagesOut,
      conversationsNew,
      conversationsResolved,
      aiHandledCount,
      handoffCount,
      contactsNew,
      leadsNew,
      ordersCount,
      revenueMinor,
      aiRequests,
      aiCostMicros,
      avgFirstResponseMs,
      avgResolutionMs,
    },
  });
}

/**
 * Returns daily rollups stored in the AnalyticsDaily table.
 */
export async function getDailyRollups(
  db: Db,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
) {
  return db.analyticsDaily.findMany({
    where: {
      workspaceId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: 'asc' },
  });
}
