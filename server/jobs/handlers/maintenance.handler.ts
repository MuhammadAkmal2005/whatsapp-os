/**
 * Housekeeping.
 *
 * Three tables accumulate rows that stop being interesting: rate-limit buckets
 * whose window has elapsed, sessions past their absolute expiry, and completed
 * jobs. None of them is harmful, and all of them slow down the indexes that keep
 * the interesting rows fast.
 *
 * Expired sessions are the one with a security dimension. They are already
 * unusable — the lookup checks the expiry, so an expired row cannot authenticate
 * anything — but each row still holds a token hash and a user id, and deleting
 * data we have no further use for is the whole of data minimisation.
 *
 * Failures are collected rather than thrown one at a time, so a problem with one
 * table does not prevent the other two from being swept.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  deleteCompletedJobsBefore,
  deleteDeadJobsBefore,
} from '@/server/repositories/job.repository';
import { deleteElapsedBuckets } from '@/server/repositories/rate-limit.repository';
import { deleteExpiredSessions } from '@/server/repositories/session.repository';
import { deleteExpiredVerificationTokens } from '@/server/repositories/verification-token.repository';
import { deleteProcessedWebhooksBefore } from '@/server/repositories/webhook-event.repository';

import type { JobContext } from '../registry';

/** Long enough that a failure investigated the next morning still has its history (3 days). */
const COMPLETED_JOB_RETENTION_MS = 3 * 24 * 60 * 60_000;
/** Processed or failed webhook records kept for 14 days for webhook forensics/reconciliation. */
const PROCESSED_WEBHOOK_RETENTION_MS = 14 * 24 * 60 * 60_000;
/** Dead jobs kept for 30 days for inspection before terminal pruning. */
const DEAD_JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Consumed verification tokens kept for 7 days. */
const CONSUMED_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60_000;

export async function maintenanceSweep(_payload: Record<string, never>, context: JobContext): Promise<void> {
  const now = new Date();
  const failures: string[] = [];

  const results = await Promise.allSettled([
    deleteElapsedBuckets(prisma, now),
    deleteExpiredSessions(prisma, now),
    deleteCompletedJobsBefore(prisma, new Date(now.getTime() - COMPLETED_JOB_RETENTION_MS)),
    deleteDeadJobsBefore(prisma, new Date(now.getTime() - DEAD_JOB_RETENTION_MS)),
    deleteProcessedWebhooksBefore(prisma, new Date(now.getTime() - PROCESSED_WEBHOOK_RETENTION_MS)),
    deleteExpiredVerificationTokens(prisma, now, new Date(now.getTime() - CONSUMED_TOKEN_RETENTION_MS)),
  ]);

  const labels = [
    'rateLimitBuckets',
    'expiredSessions',
    'completedJobs',
    'deadJobs',
    'processedWebhooks',
    'expiredVerificationTokens',
  ] as const;
  const deleted: Record<string, number> = {};

  results.forEach((result, index) => {
    const label = labels[index]!;
    if (result.status === 'fulfilled') deleted[label] = result.value;
    else failures.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });

  logger.info('maintenance.swept', { jobId: context.jobId, ...deleted });

  // Rethrown so the job is retried and the failure is visible in the dead-letter
  // view, rather than a sweep that quietly stopped working months ago.
  if (failures.length > 0) throw new Error(`Maintenance sweep partially failed — ${failures.join('; ')}`);
}
