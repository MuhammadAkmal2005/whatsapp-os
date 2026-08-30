'use server';

/**
 * Analytics Server Actions.
 *
 * Provides server-side mutations and queries for workspace analytics,
 * AI telemetry, usage metering, and daily rollups.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { formErrorFrom } from '@/server/actions/action-helpers';
import {
  exportAnalyticsReport,
  getAITelemetry,
  getAnalyticsOverview,
  getWorkspaceUsageAndLimits,
  runDailyRollup,
  type AnalyticsOverview,
  type ExportReportResult,
  type UsageLimitStatus,
} from '@/server/services/analytics/analytics.service';
import type { AITelemetryBreakdown } from '@/server/repositories/analytics.repository';
import { requirePermission } from '@/server/tenancy/context';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  aiTelemetryQuerySchema,
  dateRangeQuerySchema,
  exportAnalyticsReportSchema,
  rollupDailyInputSchema,
  usageMeteringQuerySchema,
} from '@/server/validation/analytics';

const ANALYTICS_PATH = '/analytics';

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Fetches workspace analytics overview for a given date range.
 */
export async function fetchAnalyticsOverviewAction(
  rawInput: z.input<typeof dateRangeQuerySchema> = {},
): Promise<ActionResponse<AnalyticsOverview>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'analytics:read');

    const parsed = dateRangeQuerySchema.parse(rawInput);
    const data = await getAnalyticsOverview(context, {
      from: parsed.from,
      to: parsed.to,
    });

    return { success: true, data };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}

/**
 * Fetches AI telemetry and model cost attribution breakdown.
 */
export async function fetchAITelemetryAction(
  rawInput: z.input<typeof aiTelemetryQuerySchema> = {},
): Promise<ActionResponse<AITelemetryBreakdown>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'analytics:read');

    const parsed = aiTelemetryQuerySchema.parse(rawInput);
    const data = await getAITelemetry(context, {
      from: parsed.from,
      to: parsed.to,
      agentId: parsed.agentId,
      model: parsed.model,
      source: parsed.source,
    });

    return { success: true, data };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}

/**
 * Fetches workspace usage metering and plan limit consumption status.
 */
export async function fetchUsageAndLimitsAction(
  rawInput: z.input<typeof usageMeteringQuerySchema> = {},
): Promise<ActionResponse<UsageLimitStatus>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'usage:read');

    const parsed = usageMeteringQuerySchema.parse(rawInput);
    const data = await getWorkspaceUsageAndLimits(context, parsed.periodKey);

    return { success: true, data };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}

/**
 * Triggers on-demand daily rollup aggregation for a specific date.
 * Restricted to ADMIN and OWNER roles.
 */
export async function triggerDailyRollupAction(
  rawInput: z.input<typeof rollupDailyInputSchema>,
): Promise<ActionResponse<{ date: string; workspacesProcessed: number }>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'analytics:read_advanced');

    const parsed = rollupDailyInputSchema.parse(rawInput);
    const result = await runDailyRollup({
      date: parsed.date,
      workspaceId: context.workspaceId,
    });

    revalidatePath(ANALYTICS_PATH);
    return { success: true, data: result };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}

/**
 * Exports analytics or telemetry reports in CSV or JSON format.
 */
export async function exportAnalyticsReportAction(
  rawInput: z.input<typeof exportAnalyticsReportSchema> = {},
): Promise<ActionResponse<ExportReportResult>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'analytics:read');

    const parsed = exportAnalyticsReportSchema.parse(rawInput);
    const result = await exportAnalyticsReport(context, {
      from: parsed.from,
      to: parsed.to,
      reportType: parsed.reportType,
      format: parsed.format,
    });

    return { success: true, data: result };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}
