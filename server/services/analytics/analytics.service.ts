/**
 * Analytics Service.
 *
 * Implements business logic, authorization, usage metering, and rollup orchestration
 * for workspace analytics, AI cost telemetry, and subscription plan limit checks.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  computeDailyRollupForWorkspace,
  getAIUsageAndCostBreakdown,
  getAnalyticsTimeSeries,
  getWorkspaceAnalyticsSummary,
  getWorkspaceUsageMetering,
  type AITelemetryBreakdown,
  type TimeSeriesDataPoint,
  type WorkspaceAnalyticsSummary,
} from '@/server/repositories/analytics.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import { checkLimit, getPlan, type LimitCheck, type LimitName, type PlanKey } from '@/config/plans';
import { serializeCsv } from '@/lib/csv';
import { coerceCurrency, formatMoney, money } from '@/lib/money';

const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AnalyticsOverview = {
  summary: WorkspaceAnalyticsSummary;
  timeSeries: TimeSeriesDataPoint[];
  period: {
    from: string;
    to: string;
  };
};

export type UsageLimitStatus = {
  planKey: PlanKey;
  planName: string;
  periodKey: string;
  limits: Record<LimitName, LimitCheck>;
};

/**
 * Returns high-level KPI summary and daily time-series trends for the workspace.
 */
export async function getAnalyticsOverview(
  context: TenantContext,
  params: { from?: Date; to?: Date } = {},
  db: Db = prisma,
): Promise<AnalyticsOverview> {
  requirePermission(context, 'analytics:read');

  const now = new Date();
  const to = params.to ?? now;
  const from = params.from ?? new Date(now.getTime() - DEFAULT_DAYS * DAY_MS);

  const [summary, timeSeries] = await Promise.all([
    getWorkspaceAnalyticsSummary(db, context.workspaceId, from, to),
    getAnalyticsTimeSeries(db, context.workspaceId, from, to),
  ]);

  return {
    summary,
    timeSeries,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
}

/**
 * Returns detailed AI telemetry, model cost attribution, and handoff insights.
 */
export async function getAITelemetry(
  context: TenantContext,
  params: { from?: Date; to?: Date; agentId?: string; model?: string; source?: string } = {},
  db: Db = prisma,
): Promise<AITelemetryBreakdown> {
  requirePermission(context, 'analytics:read');

  const now = new Date();
  const to = params.to ?? now;
  const from = params.from ?? new Date(now.getTime() - DEFAULT_DAYS * DAY_MS);

  return getAIUsageAndCostBreakdown(db, context.workspaceId, from, to, {
    agentId: params.agentId,
    model: params.model,
    source: params.source,
  });
}

/**
 * Evaluates current workspace resource usage against plan limits.
 */
export async function getWorkspaceUsageAndLimits(
  context: TenantContext,
  periodKey?: string,
  db: Db = prisma,
): Promise<UsageLimitStatus> {
  requirePermission(context, 'usage:read');

  const activePeriod = periodKey ?? new Date().toISOString().slice(0, 7); // YYYY-MM

  // Get active subscription or fallback to free plan
  const sub = await db.subscription.findUnique({
    where: { workspaceId: context.workspaceId },
    select: { planKey: true, status: true },
  });

  const planKey = (sub?.planKey ?? 'free') as PlanKey;
  const plan = getPlan(planKey);

  const [usageMetrics, contactsCount, productsCount, automationsCount, numbersCount, membersCount] =
    await Promise.all([
      getWorkspaceUsageMetering(db, context.workspaceId, activePeriod),
      db.contact.count({ where: { workspaceId: context.workspaceId, deletedAt: null } }),
      db.product.count({ where: { workspaceId: context.workspaceId, deletedAt: null } }),
      db.automation.count({ where: { workspaceId: context.workspaceId } }),
      db.whatsAppPhoneNumber.count({ where: { workspaceId: context.workspaceId } }),
      db.workspaceMember.count({ where: { workspaceId: context.workspaceId, status: 'ACTIVE' } }),
    ]);

  const metricQuantityMap = new Map(usageMetrics.map((m) => [m.metric, m.quantity]));

  const aiRequestsUsed = metricQuantityMap.get('AI_REQUEST') ?? 0;
  const outboundMessagesUsed = metricQuantityMap.get('WHATSAPP_MESSAGE_SENT') ?? 0;
  const storageBytesUsed = metricQuantityMap.get('STORAGE_BYTES') ?? 0;
  const storageMegabytesUsed = Math.ceil(storageBytesUsed / (1024 * 1024));

  const limits: Record<LimitName, LimitCheck> = {
    whatsappNumbers: checkLimit(planKey, 'whatsappNumbers', numbersCount),
    teamMembers: checkLimit(planKey, 'teamMembers', membersCount),
    contacts: checkLimit(planKey, 'contacts', contactsCount),
    products: checkLimit(planKey, 'products', productsCount),
    aiRequestsPerMonth: checkLimit(planKey, 'aiRequestsPerMonth', aiRequestsUsed),
    messagesPerMonth: checkLimit(planKey, 'messagesPerMonth', outboundMessagesUsed),
    knowledgeDocuments: checkLimit(planKey, 'knowledgeDocuments', 0),
    storageMegabytes: checkLimit(planKey, 'storageMegabytes', storageMegabytesUsed),
    automations: checkLimit(planKey, 'automations', automationsCount),
    campaignsPerMonth: checkLimit(planKey, 'campaignsPerMonth', 0),
  };

  return {
    planKey,
    planName: plan.name,
    periodKey: activePeriod,
    limits,
  };
}

/**
 * Runs daily analytics rollup aggregation for a specific workspace or across all active workspaces.
 */
export async function runDailyRollup(
  params: { date: Date; workspaceId?: string },
  db: Db = prisma,
): Promise<{ workspacesProcessed: number; date: string }> {
  const dateStr = params.date.toISOString().split('T')[0]!;

  if (params.workspaceId) {
    await computeDailyRollupForWorkspace(db, params.workspaceId, params.date);
    logger.info('analytics.daily_rollup_completed', {
      workspaceId: params.workspaceId,
      date: dateStr,
    });
    return { workspacesProcessed: 1, date: dateStr };
  }

  const workspaces = await db.workspace.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  for (const ws of workspaces) {
    try {
      await computeDailyRollupForWorkspace(db, ws.id, params.date);
    } catch (err) {
      logger.error('analytics.daily_rollup_failed_workspace', {
        workspaceId: ws.id,
        date: dateStr,
        error: err,
      });
    }
  }

  logger.info('analytics.daily_rollup_batch_completed', {
    workspacesProcessed: workspaces.length,
    date: dateStr,
  });

  return { workspacesProcessed: workspaces.length, date: dateStr };
}

export type ExportReportResult = {
  filename: string;
  mimeType: string;
  content: string;
};

/**
 * Exports formatted analytics, AI telemetry, plan usage, or daily rollups as CSV or JSON.
 */
export async function exportAnalyticsReport(
  context: TenantContext,
  params: {
    from?: Date;
    to?: Date;
    reportType?: 'overview' | 'ai_telemetry' | 'usage' | 'daily_rollups';
    format?: 'csv' | 'json';
  } = {},
  db: Db = prisma,
): Promise<ExportReportResult> {
  requirePermission(context, 'analytics:read');

  const reportType = params.reportType ?? 'overview';
  const format = params.format ?? 'csv';
  const now = new Date();
  const to = params.to ?? now;
  const from = params.from ?? new Date(now.getTime() - DEFAULT_DAYS * DAY_MS);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];
  const dateSuffix = `${fromStr}_to_${toStr}`;

  if (reportType === 'ai_telemetry') {
    const telemetry = await getAITelemetry(context, { from, to }, db);
    const filename = `ai_telemetry_${dateSuffix}.${format}`;

    if (format === 'json') {
      return {
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(telemetry, null, 2),
      };
    }

    const headers = [
      'Model',
      'Invocations',
      'Input Tokens',
      'Output Tokens',
      'Total Tokens',
      'Cost (Micros)',
      'Cost (USD)',
      'Avg Latency (ms)',
      'Grounding Pass Rate (%)',
      'Safety Blocked',
      'Human Handoffs',
    ];

    const totalBlocked = Object.values(telemetry.byBlockedReason).reduce((a, b) => a + b, 0);
    const totalHandoffs = Object.values(telemetry.byHandoffReason).reduce((a, b) => a + b, 0);

    const rows = telemetry.byModel.map((m) => [
      m.model,
      m.requests,
      m.inputTokens,
      m.outputTokens,
      m.totalTokens,
      m.costMicros,
      (m.costMicros / 1_000_000).toFixed(4),
      Math.round(m.avgLatencyMs),
      telemetry.groundingPassRate.toFixed(1),
      totalBlocked,
      totalHandoffs,
    ]);

    return {
      filename,
      mimeType: 'text/csv',
      content: serializeCsv(headers, rows),
    };
  }

  if (reportType === 'usage') {
    requirePermission(context, 'usage:read');
    const usage = await getWorkspaceUsageAndLimits(context, undefined, db);
    const filename = `usage_metering_${usage.periodKey}.${format}`;

    if (format === 'json') {
      return {
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(usage, null, 2),
      };
    }

    const headers = ['Resource / Limit', 'Current Usage', 'Plan Limit', 'Utilization (%)', 'Status'];
    const rows = Object.entries(usage.limits).map(([name, check]) => [
      name,
      check.used,
      check.limit === null ? 'Unlimited' : check.limit,
      check.limit === null || check.limit === 0
        ? '0%'
        : `${Math.min(100, Math.round(check.ratio * 100))}%`,
      !check.allowed ? 'EXCEEDED' : check.nearLimit ? 'NEAR_LIMIT' : 'OK',
    ]);

    return {
      filename,
      mimeType: 'text/csv',
      content: serializeCsv(headers, rows),
    };
  }

  if (reportType === 'daily_rollups') {
    const rollups = await db.analyticsDaily.findMany({
      where: {
        workspaceId: context.workspaceId,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });

    const filename = `daily_rollups_${dateSuffix}.${format}`;

    if (format === 'json') {
      return {
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(rollups, null, 2),
      };
    }

    const headers = [
      'Date',
      'Revenue Minor',
      'Orders',
      'Messages Inbound',
      'Messages Outbound',
      'New Conversations',
      'Resolved Conversations',
      'AI Handled',
      'AI Requests',
      'AI Cost Micros',
    ];

    const rows = rollups.map((r) => [
      r.date.toISOString().split('T')[0],
      r.revenueMinor,
      r.ordersCount,
      r.messagesIn,
      r.messagesOut,
      r.conversationsNew,
      r.conversationsResolved,
      r.aiHandledCount,
      r.aiRequests,
      r.aiCostMicros,
    ]);

    return {
      filename,
      mimeType: 'text/csv',
      content: serializeCsv(headers, rows),
    };
  }

  // Default: overview
  const overview = await getAnalyticsOverview(context, { from, to }, db);
  const filename = `analytics_overview_${dateSuffix}.${format}`;

  if (format === 'json') {
    return {
      filename,
      mimeType: 'application/json',
      content: JSON.stringify(overview, null, 2),
    };
  }

  const headers = [
    'Date',
    'Revenue (Minor)',
    'Revenue (Formatted)',
    'Currency',
    'Total Orders',
    'Messages Inbound',
    'Messages Outbound',
    'New Conversations',
    'AI Requests',
  ];

  const currency = coerceCurrency(context.currency);

  const rows = overview.timeSeries.map((ts) => [
    ts.date,
    ts.revenueMinor,
    formatMoney(money(ts.revenueMinor, currency)),
    currency,
    ts.ordersCount,
    ts.messagesIn,
    ts.messagesOut,
    ts.conversationsNew,
    ts.aiRequests,
  ]);

  return {
    filename,
    mimeType: 'text/csv',
    content: serializeCsv(headers, rows),
  };
}

