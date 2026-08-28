/**
 * The PostgreSQL job queue driver.
 *
 * Thin by design: the interesting SQL is in `server/repositories/job.repository`
 * and the retry arithmetic is in `../backoff`. What is left here is the mapping
 * between the two — turning a claimed row into a validated `ClaimedJob`, and
 * turning a thrown error into either a reschedule or a dead letter.
 *
 * The one decision worth calling out is how an unparseable payload is handled. It
 * goes straight to DEAD without consuming the retry budget, because a payload
 * that does not match its schema will not match it on the fourth attempt either.
 * Retrying it would waste attempts and bury the real signal — that a deployment
 * changed a payload shape without a migration path for jobs already in flight.
 */

import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  claimJobs,
  countJobsByStatus,
  insertJob,
  markJobCompleted,
  markJobDead,
  markJobRetrying,
  oldestPendingRunAfter,
  reclaimStalledJobs,
} from '@/server/repositories/job.repository';

import { type BackoffConfig, DEFAULT_BACKOFF, isExhausted, lockExpiredBefore, nextRunAt } from '../backoff';
import {
  isJobType,
  JOB_DEFAULTS,
  type JobPayloadInput,
  type JobType,
  parseJobPayload,
} from '../job-types';
import type { ClaimedJob, EnqueueOptions, EnqueueResult, JobQueue, QueueStats } from '../queue';

/** Truncated because `last_error` is a text column that gets read by humans in a
 *  table cell, and a 40kB stack trace there is worse than useless. */
const MAX_ERROR_LENGTH = 2_000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const detail = error.stack ?? `${error.name}: ${error.message}`;
    return detail.slice(0, MAX_ERROR_LENGTH);
  }
  return String(error).slice(0, MAX_ERROR_LENGTH);
}

export type PostgresQueueOptions = {
  readonly backoff?: BackoffConfig;
  /** Injected so tests are deterministic. Production passes Math.random. */
  readonly jitter?: () => number;
  readonly now?: () => Date;
};

export function createPostgresQueue(options: PostgresQueueOptions = {}): JobQueue {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const jitter = options.jitter ?? Math.random;
  const now = options.now ?? (() => new Date());

  return {
    async enqueue<T extends JobType>(
      type: T,
      payload: JobPayloadInput<T>,
      enqueueOptions: EnqueueOptions = {},
    ): Promise<EnqueueResult> {
      // Read without an `?? {}` fallback: the empty literal widens the union to
      // include a type with no such properties, so `defaults.maxAttempts` stops
      // type-checking. Optional chaining below carries the absent case instead.
      const defaults = JOB_DEFAULTS[type];

      // Validated on the way in as well as on the way out. Catching a malformed
      // payload at the call site gives a stack trace that points at the bug,
      // whereas catching it in the worker points at the worker.
      const parsed = parseJobPayload(type, payload);
      if (!parsed.ok) throw new Error(parsed.message);

      const workspaceId =
        typeof (parsed.payload as { workspaceId?: unknown }).workspaceId === 'string'
          ? ((parsed.payload as { workspaceId: string }).workspaceId)
          : null;

      const result = await insertJob(prisma, {
        type,
        payload: parsed.payload as Prisma.InputJsonValue,
        workspaceId,
        runAfter: enqueueOptions.runAt ?? now(),
        maxAttempts: enqueueOptions.maxAttempts ?? defaults?.maxAttempts ?? 5,
        priority: enqueueOptions.priority ?? defaults?.priority ?? 0,
        dedupeKey: enqueueOptions.dedupeKey ?? null,
      });

      logger.debug('job.enqueued', { jobId: result.id, type, created: result.created, workspaceId });
      return result;
    },

    async claim(workerId: string, limit: number): Promise<ClaimedJob[]> {
      const rows = await claimJobs(prisma, workerId, limit);
      const claimed: ClaimedJob[] = [];

      for (const row of rows) {
        if (!isJobType(row.type)) {
          // A job type that no longer exists in the catalogue — usually a removed
          // feature whose jobs are still queued. Dead, not retried.
          await markJobDead(prisma, row.id, `Unknown job type "${row.type}".`);
          logger.warn('job.unknown_type', { jobId: row.id, type: row.type });
          continue;
        }

        const parsed = parseJobPayload(row.type, row.payload);
        if (!parsed.ok) {
          await markJobDead(prisma, row.id, parsed.message);
          logger.warn('job.invalid_payload', { jobId: row.id, type: row.type, reason: parsed.message });
          continue;
        }

        claimed.push({
          id: row.id,
          type: row.type,
          payload: parsed.payload,
          workspaceId: row.workspace_id,
          attempts: Number(row.attempts),
          maxAttempts: Number(row.max_attempts),
        });
      }

      return claimed;
    },

    async complete(jobId: string): Promise<void> {
      await markJobCompleted(prisma, jobId);
    },

    async fail(jobId: string, error: unknown): Promise<void> {
      const detail = describeError(error);

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { attempts: true, maxAttempts: true, type: true },
      });

      if (!job) {
        logger.warn('job.fail_missing', { jobId });
        return;
      }

      if (isExhausted(job.attempts, job.maxAttempts)) {
        await markJobDead(prisma, jobId, detail);
        logger.error('job.dead', { jobId, type: job.type, attempts: job.attempts });
        return;
      }

      const runAfter = nextRunAt(now(), job.attempts, jitter(), backoff);
      await markJobRetrying(prisma, jobId, runAfter, detail);
      logger.warn('job.retrying', {
        jobId,
        type: job.type,
        attempts: job.attempts,
        runAfter: runAfter.toISOString(),
      });
    },

    async reclaimStalled(): Promise<number> {
      const count = await reclaimStalledJobs(prisma, lockExpiredBefore(now()));
      if (count > 0) logger.warn('job.reclaimed', { count });
      return count;
    },

    async stats(): Promise<QueueStats> {
      const [counts, oldest] = await Promise.all([
        countJobsByStatus(prisma),
        oldestPendingRunAfter(prisma),
      ]);

      return {
        pending: counts.PENDING ?? 0,
        running: counts.RUNNING ?? 0,
        dead: counts.DEAD ?? 0,
        oldestPendingAgeSeconds:
          oldest === null ? null : Math.max(0, Math.round((now().getTime() - oldest.getTime()) / 1000)),
      };
    },
  };
}
