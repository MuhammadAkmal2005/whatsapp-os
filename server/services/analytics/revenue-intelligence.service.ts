/**
 * Revenue Intelligence Service.
 *
 * Provides workspace-scoped, authoritative revenue intelligence,
 * chat-to-order attribution, product demand signals, AI operational outcomes,
 * and period-over-period trend analysis.
 *
 * Guarantees:
 * - Strict multi-tenant isolation (always scoped to context.workspaceId)
 * - Zero fabricated attribution (clearly distinguishes chat-correlated orders from general orders)
 * - Safe numeric handling (division-by-zero guards, currency minor integer precision)
 * - Data minimization (excludes raw customer PII from analytics payloads)
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import {
  getRevenueIntelligenceSummary,
  getRevenueIntelligenceTrends,
  getRevenueTimeSeries,
  type RevenueDailyPoint,
  type RevenueIntelligenceSummary,
  type RevenueIntelligenceTrends,
} from '@/server/repositories/revenue-intelligence.repository';
import type { SupportedCurrency } from '@/config/constants';

export interface RevenueIntelligenceReport {
  summary: RevenueIntelligenceSummary;
  trends: RevenueIntelligenceTrends;
  timeSeries: RevenueDailyPoint[];
  period: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    rangeKey: string;
    formattedRange: string;
  };
  currency: SupportedCurrency;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RevenueDateRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  rangeKey: string;
  formattedRange: string;
}

/**
 * Resolves standard date ranges and their exact previous equivalent comparison windows.
 */
export function resolveComparisonRange(params: {
  range?: string;
  from?: Date | string;
  to?: Date | string;
}): RevenueDateRange {
  const now = new Date();
  const range = params.range ?? '30d';

  let from: Date;
  let to: Date;
  let rangeKey = range;
  let formattedRange = 'Last 30 days';

  if (params.from && params.to) {
    const customFrom = new Date(params.from);
    const customTo = new Date(params.to);
    if (!isNaN(customFrom.getTime()) && !isNaN(customTo.getTime()) && customFrom <= customTo) {
      from = customFrom;
      to = customTo;
      rangeKey = 'custom';
      formattedRange = `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      from = new Date(now.getTime() - 30 * DAY_MS);
      to = now;
    }
  } else if (range === 'today') {
    from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    to = now;
    rangeKey = 'today';
    formattedRange = 'Today';
  } else if (range === '7d') {
    from = new Date(now.getTime() - 7 * DAY_MS);
    to = now;
    rangeKey = '7d';
    formattedRange = 'Last 7 days';
  } else if (range === '90d') {
    from = new Date(now.getTime() - 90 * DAY_MS);
    to = now;
    rangeKey = '90d';
    formattedRange = 'Last 90 days';
  } else if (range === 'this_month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = now;
    rangeKey = 'this_month';
    formattedRange = 'This month';
  } else if (range === 'last_month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    rangeKey = 'last_month';
    formattedRange = 'Last month';
  } else {
    // Default 30d
    from = new Date(now.getTime() - 30 * DAY_MS);
    to = now;
    rangeKey = '30d';
    formattedRange = 'Last 30 days';
  }

  // Calculate equivalent preceding window
  const durationMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs);

  return {
    from,
    to,
    previousFrom,
    previousTo,
    rangeKey,
    formattedRange,
  };
}

/**
 * Returns complete Revenue Intelligence report including summary, trends, and time series.
 */
export async function getRevenueIntelligence(
  context: TenantContext,
  params: { range?: string; from?: Date | string; to?: Date | string } = {},
  db: Db = prisma,
): Promise<RevenueIntelligenceReport> {
  requirePermission(context, 'analytics:read');

  const { from, to, previousFrom, previousTo, rangeKey, formattedRange } =
    resolveComparisonRange(params);

  const [summary, trends, timeSeries] = await Promise.all([
    getRevenueIntelligenceSummary(db, context.workspaceId, from, to),
    getRevenueIntelligenceTrends(db, context.workspaceId, from, to, previousFrom, previousTo),
    getRevenueTimeSeries(db, context.workspaceId, from, to),
  ]);

  return {
    summary,
    trends,
    timeSeries,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
      rangeKey,
      formattedRange,
    },
    currency: context.currency as SupportedCurrency,
  };
}
