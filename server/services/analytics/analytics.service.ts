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
