/**
 * Retry scheduling for the background queue.
 *
 * Pure arithmetic, deliberately separated from the driver so it can be tested
 * without a database. Everything here is a function of (attempt, config) and a
 * caller-supplied jitter value — there is no hidden `Date.now()` and no hidden
 * `Math.random()`, because a scheduler you cannot reproduce is a scheduler you
 * cannot debug at 3am.
 *
 * The shape is exponential backoff with full jitter. Exponential because a
 * failing dependency needs progressively longer to recover; jittered because
 * without it every job that failed during the same outage retries in the same
 * instant and knocks the dependency over again the moment it comes back. Full
 * jitter (uniform over the whole interval, rather than base ± a little) is the
 * variant that spreads a thundering herd best, and the cost — some retries
 * happening sooner than the nominal delay — is irrelevant for our workloads.
 */

export type BackoffConfig = {
  /** Delay after the first failure, before exponential growth. */
  readonly baseDelayMs: number;
  /** Ceiling, so attempt 20 does not schedule itself for next week. */
  readonly maxDelayMs: number;
  readonly factor: number;
};

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 5_000,
  maxDelayMs: 30 * 60_000,
  factor: 3,
};

/**
 * The un-jittered delay for a given attempt number.
 *
 * `attempt` is 1-based and counts attempts already made, so the delay after the
 * first failure is `baseDelayMs`. Values below 1 are clamped rather than
 * rejected: a nonsensical attempt count should not be able to schedule a job in
 * the past and spin the worker.
 */
export function backoffDelayMs(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const growth = config.factor ** (safeAttempt - 1);
  const uncapped = config.baseDelayMs * growth;

  // `**` on large attempt counts reaches Infinity, and Math.min handles that
  // correctly, but NaN would slip through — so guard the input instead.
  if (!Number.isFinite(uncapped)) return config.maxDelayMs;

  return Math.min(Math.round(uncapped), config.maxDelayMs);
}

/**
 * Applies full jitter to a delay.
 *
 * `jitter` is a caller-supplied value in [0, 1) — `Math.random()` in production,
 * a fixed value in tests. Out-of-range input is clamped so a bad caller cannot
 * produce a negative delay.
 */
export function applyJitter(delayMs: number, jitter: number): number {
  const clamped = Math.min(Math.max(jitter, 0), 0.999_999);
  return Math.round(delayMs * clamped);
}

/**
 * When a job that has just failed should next become eligible.
 *
 * Returns the absolute timestamp rather than a delay because that is what the
 * `jobs.run_after` column stores, and converting in one place removes a class of
 * off-by-one-clock bug.
 */
export function nextRunAt(
  now: Date,
  attempt: number,
  jitter: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
): Date {
  const delay = applyJitter(backoffDelayMs(attempt, config), jitter);
  return new Date(now.getTime() + delay);
}

/**
 * Whether a failed job has any attempts left.
 *
 * Exhausted jobs go to `DEAD` rather than `FAILED` so that "needs a human" is
 * distinguishable from "will try again", and so a dead-letter view is a simple
 * indexed query rather than a scan comparing two columns.
 */
export function isExhausted(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

/**
 * How long a claimed job may stay locked before another worker may take it.
 *
 * A worker that is killed mid-job leaves `locked_at` set and no completion, and
 * without a reclaim window that job is stranded forever. The window has to be
 * comfortably longer than the slowest legitimate handler — a document ingestion
 * with embeddings is the long pole — because reclaiming a job that is still
 * running means executing it twice. Handlers are idempotent, but "idempotent"
 * covers correctness, not the cost of doing the work twice.
 */
export const LOCK_TIMEOUT_MS = 5 * 60_000;

export function lockExpiredBefore(now: Date, lockTimeoutMs = LOCK_TIMEOUT_MS): Date {
  return new Date(now.getTime() - lockTimeoutMs);
}
