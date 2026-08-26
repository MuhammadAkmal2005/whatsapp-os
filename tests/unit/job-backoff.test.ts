/**
 * Retry-scheduling tests.
 *
 * The queue's database behaviour needs a real PostgreSQL instance and belongs in
 * the integration suite. What is tested here is the arithmetic that decides *when*
 * a failed job runs again — the part that is pure, and the part where an error is
 * expensive: too short a delay hammers a dependency that is already failing, too
 * long and a customer waits, and an unbounded one schedules a retry for next month.
 */

import { describe, expect, it } from 'vitest';

import {
  applyJitter,
  backoffDelayMs,
  type BackoffConfig,
  DEFAULT_BACKOFF,
  isExhausted,
  LOCK_TIMEOUT_MS,
  lockExpiredBefore,
  nextRunAt,
} from '@/server/jobs/backoff';
import { dedupeKey } from '@/server/jobs/queue';

const config: BackoffConfig = { baseDelayMs: 1_000, maxDelayMs: 60_000, factor: 2 };

describe('backoffDelayMs', () => {
  it('returns the base delay for the first failure', () => {
    expect(backoffDelayMs(1, config)).toBe(1_000);
  });

  it('grows by the configured factor', () => {
    expect(backoffDelayMs(2, config)).toBe(2_000);
    expect(backoffDelayMs(3, config)).toBe(4_000);
    expect(backoffDelayMs(4, config)).toBe(8_000);
  });

  it('caps at the ceiling rather than growing without bound', () => {
    expect(backoffDelayMs(10, config)).toBe(60_000);
    expect(backoffDelayMs(500, config)).toBe(60_000);
  });

  it('survives an attempt count large enough to overflow to Infinity', () => {
    // 2 ** 1100 is Infinity in a double. Without the guard this returns NaN and
    // schedules the job at an invalid date, which Postgres rejects — losing the job.
    const delay = backoffDelayMs(1_100, config);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBe(60_000);
  });

  it('clamps a nonsensical attempt count instead of scheduling in the past', () => {
    expect(backoffDelayMs(0, config)).toBe(1_000);
    expect(backoffDelayMs(-5, config)).toBe(1_000);
  });

  it('is monotonic up to the cap under the shipped defaults', () => {
    let previous = 0;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const delay = backoffDelayMs(attempt, DEFAULT_BACKOFF);
      expect(delay).toBeGreaterThanOrEqual(previous);
      expect(delay).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxDelayMs);
      previous = delay;
    }
  });
});

describe('applyJitter', () => {
  it('scales the delay by the jitter fraction', () => {
    expect(applyJitter(10_000, 0.5)).toBe(5_000);
    expect(applyJitter(10_000, 0)).toBe(0);
  });

  it('never exceeds the delay, so the ceiling still holds after jitter', () => {
    expect(applyJitter(10_000, 0.999_999_9)).toBeLessThanOrEqual(10_000);
  });

  it('clamps out-of-range input rather than producing a negative delay', () => {
    expect(applyJitter(10_000, -3)).toBe(0);
    expect(applyJitter(10_000, 5)).toBeLessThanOrEqual(10_000);
  });
});

describe('nextRunAt', () => {
  const now = new Date('2026-08-27T10:00:00.000Z');

  it('schedules strictly in the future for a non-zero jitter', () => {
    const scheduled = nextRunAt(now, 2, 0.5, config);
    expect(scheduled.getTime()).toBe(now.getTime() + 1_000);
  });

  it('never schedules in the past, even with zero jitter', () => {
    const scheduled = nextRunAt(now, 3, 0, config);
    expect(scheduled.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('produces a valid date at the extremes', () => {
    expect(Number.isNaN(nextRunAt(now, 5_000, 0.9, config).getTime())).toBe(false);
  });
});

describe('isExhausted', () => {
  it('is true once attempts have reached the budget', () => {
    // attempts is incremented at claim time, so a job on its fifth attempt of five
    // has no further chances — off-by-one here means one extra run of every failure.
    expect(isExhausted(5, 5)).toBe(true);
    expect(isExhausted(6, 5)).toBe(true);
  });

  it('is false while attempts remain', () => {
    expect(isExhausted(1, 5)).toBe(false);
    expect(isExhausted(4, 5)).toBe(false);
  });
});

describe('lockExpiredBefore', () => {
  it('looks back by exactly the lock timeout', () => {
    const now = new Date('2026-08-27T10:00:00.000Z');
    expect(lockExpiredBefore(now).getTime()).toBe(now.getTime() - LOCK_TIMEOUT_MS);
  });

  it('uses a window longer than the slowest expected handler', () => {
    // Reclaiming a job that is still running executes it twice. Document ingestion
    // is the long pole, so the window must not be trimmed below a few minutes.
    expect(LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('dedupeKey', () => {
  it('namespaces by type, so an entity id cannot collide across types', () => {
    const a = dedupeKey('ai.respond', 'conversation-1');
    const b = dedupeKey('ai.summarise_conversation', 'conversation-1');
    expect(a).not.toBe(b);
  });

  it('is stable for the same inputs', () => {
    expect(dedupeKey('maintenance.sweep', 'x')).toBe(dedupeKey('maintenance.sweep', 'x'));
  });
});
