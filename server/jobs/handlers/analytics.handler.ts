/**
 * Background Job Handler: Analytics Daily Rollup.
 *
 * Computes daily metrics aggregation across conversations, messages, orders,
 * revenue, and AI turns, persisting pre-computed rollups into `AnalyticsDaily`.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { runDailyRollup } from '@/server/services/analytics/analytics.service';
import type { JobHandler } from '../registry';

export const analyticsRollupDailyHandler: JobHandler<'analytics.rollup_daily'> = async (
  payload,
  context,
) => {
  logger.info('analytics.rollup_job_started', {
    jobId: context.jobId,
    date: payload.date,
    workspaceId: payload.workspaceId,
  });

  const targetDate = new Date(payload.date);

  const result = await runDailyRollup({
    date: targetDate,
    workspaceId: payload.workspaceId,
  });

  logger.info('analytics.rollup_job_finished', {
    jobId: context.jobId,
    date: result.date,
    workspacesProcessed: result.workspacesProcessed,
  });
};
