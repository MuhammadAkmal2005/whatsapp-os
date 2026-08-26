/**
 * The queue contract.
 *
 * `JobQueue` is the seam that keeps the rest of the application from caring how
 * background work is stored. The default driver is PostgreSQL, which is the right
 * default at our scale: the database is already there, already backed up, and
 * `FOR UPDATE SKIP LOCKED` gives correct competition between workers without
 * operating a broker. Making Redis a hard dependency for an MVP buys queue
 * throughput we do not need and costs an extra piece of infrastructure that can
 * fail independently.
 *
 * The interface is deliberately small — enqueue, claim, complete, fail — because
 * every method is one a Redis or SQS driver would also have to implement. Nothing
 * PostgreSQL-specific leaks through it.
 */

import type { JobPayload, JobPayloadInput, JobType } from './job-types';

export type EnqueueOptions = {
  /** Earliest time the job may run. Absent means immediately. */
  readonly runAt?: Date;
  /** Overrides the per-type default from JOB_DEFAULTS. */
  readonly maxAttempts?: number;
  /** Higher runs first among eligible jobs. */
  readonly priority?: number;
  /**
   * Makes enqueueing idempotent. A second enqueue with the same key is a no-op
   * that returns the existing job, which is what lets an at-least-once caller —
   * a retried webhook, say — safely enqueue the same follow-up twice.
   *
   * Keys are global, not per type, because the column carries a global unique
   * constraint. Include the workspace and the type in the key you build.
   */
  readonly dedupeKey?: string;
};

export type EnqueueResult = {
  readonly id: string;
  /** False when a dedupeKey matched an existing job, so the caller can tell
   *  "queued" from "already queued" without a second query. */
  readonly created: boolean;
};

/** A job claimed by a worker, with its payload already validated. */
export type ClaimedJob<T extends JobType = JobType> = {
  readonly id: string;
  readonly type: T;
  readonly payload: JobPayload<T>;
  readonly workspaceId: string | null;
  /** Includes the current attempt, so a first run reports 1. */
  readonly attempts: number;
  readonly maxAttempts: number;
};

export interface JobQueue {
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadInput<T>,
    options?: EnqueueOptions,
  ): Promise<EnqueueResult>;

  /**
   * Atomically claims up to `limit` eligible jobs for `workerId`.
   *
   * Must be safe to call concurrently from many workers — that requirement is
   * the whole reason this method exists on the interface rather than being a
   * read followed by an update in the worker loop.
   */
  claim(workerId: string, limit: number): Promise<ClaimedJob[]>;

  complete(jobId: string): Promise<void>;

  /**
   * Records a failure and either reschedules with backoff or, once the attempt
   * budget is spent, moves the job to the dead-letter state.
   */
  fail(jobId: string, error: unknown): Promise<void>;

  /** Returns jobs whose lock has outlived the timeout to PENDING. */
  reclaimStalled(): Promise<number>;

  /** For the dashboard and for health checks. */
  stats(): Promise<QueueStats>;
}

export type QueueStats = {
  readonly pending: number;
  readonly running: number;
  readonly dead: number;
  /** Age of the oldest eligible job, in seconds. The number that tells you the
   *  queue is falling behind — depth alone does not, because a deep queue that
   *  is draining fast is healthy. */
  readonly oldestPendingAgeSeconds: number | null;
};

/**
 * Builds a dedupe key.
 *
 * Centralised so keys are formatted one way and cannot collide across types by
 * accident. The type prefix is what makes a bare entity id safe to pass.
 */
export function dedupeKey(type: JobType, ...parts: readonly string[]): string {
  return [type, ...parts].join(':');
}
