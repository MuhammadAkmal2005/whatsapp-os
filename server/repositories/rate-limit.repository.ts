/**
 * Rate-limit storage.
 *
 * The pure arithmetic is in `server/ratelimit/window.ts`; this is the database
 * side of it. The whole point of a fixed window is that it can be maintained
 * with one atomic statement, so the increment is a raw `INSERT ... ON CONFLICT`
 * rather than a read-modify-write that would race under exactly the concurrent
 * load a limiter exists to survive.
 *
 * The `CASE` in the update is the window roll-over: if the stored window has
 * already elapsed, the row resets to a count of one in the new window; otherwise
 * the count is incremented within the current one. Both branches happen inside
 * the single conflicting write, so two simultaneous requests cannot both see a
 * stale count and both reset it.
 */

import 'server-only';

import { Prisma } from '@prisma/client';

import type { Db } from '@/db/prisma';

export type BucketState = {
  /** Count after this attempt has been recorded. */
  count: number;
  resetAt: Date;
};

/**
 * Records one attempt against `key` and returns the resulting count.
 *
 * `resetAt` is the end of the window this attempt falls into, computed by the
 * caller from epoch-aligned window arithmetic so every process agrees on the
 * boundary without coordination.
 */
export async function incrementBucket(
  db: Db,
  key: string,
  resetAt: Date,
): Promise<BucketState> {
  const rows = await db.$queryRaw<{ count: number; reset_at: Date }[]>(Prisma.sql`
    INSERT INTO rate_limit_buckets (key, count, reset_at, updated_at)
    VALUES (${key}, 1, ${resetAt}, now())
    ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN rate_limit_buckets.reset_at <= now() THEN 1
          ELSE rate_limit_buckets.count + 1
        END,
        reset_at = CASE
          WHEN rate_limit_buckets.reset_at <= now() THEN EXCLUDED.reset_at
          ELSE rate_limit_buckets.reset_at
        END,
        updated_at = now()
    RETURNING count, reset_at
  `);

  const row = rows[0];
  if (!row) {
    // RETURNING on an upsert always yields a row; a missing one means the query
    // shape changed, which should fail loudly rather than silently allow.
    throw new Error('Rate-limit upsert returned no row.');
  }
  return { count: Number(row.count), resetAt: new Date(row.reset_at) };
}

/** Housekeeping for a scheduled job. Elapsed buckets are harmless but accumulate. */
export async function deleteElapsedBuckets(db: Db, now: Date): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } });
  return result.count;
}
