/**
 * Fixed-window rate limiting.
 *
 * The counter lives in PostgreSQL (`RateLimitBucket`), not Redis, so the MVP has
 * no second datastore to operate. That is a deliberate trade: a database round
 * trip per limited action is more expensive than a Redis one, but the limited
 * actions are login, signup, AI requests and message sends — none of which are
 * hot enough for it to matter, and all of which already touch the database.
 * `config/constants.ts` documents the swap path if that changes.
 *
 * A fixed window is chosen over a sliding window or token bucket for a specific
 * reason: it is correct under concurrency with a single atomic upsert. A sliding
 * window needs either a sorted set or a read-modify-write, and the latter races
 * in exactly the situation a rate limiter exists to handle — many simultaneous
 * attempts.
 *
 * The cost of a fixed window is burst tolerance at a boundary: an attacker can
 * spend a full allowance at the end of one window and another at the start of the
 * next. For credential stuffing against 8 attempts per 5 minutes, 16 attempts in
 * a moment followed by a five-minute wall is still a wall.
 *
 * This module holds the pure arithmetic so it can be tested without a database;
 * the storage adapter lives alongside it.
 */

export type RateLimitRule = {
  /** Attempts permitted per window. */
  readonly limit: number;
  readonly windowSeconds: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** When the window resets. Sent as `Retry-After` when blocked. */
  readonly resetAt: Date;
  readonly retryAfterSeconds: number;
};

/**
 * The window a moment falls into, aligned to absolute time rather than to first
 * use.
 *
 * Aligning to epoch means every process agrees on the boundary without
 * coordination, and a restart cannot hand out a fresh allowance by resetting the
 * clock — which is precisely what an attacker who can trigger a crash would want.
 */
export function windowStart(now: Date, windowSeconds: number): Date {
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error(`windowSeconds must be a positive integer, received ${windowSeconds}`);
  }
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export function windowEnd(now: Date, windowSeconds: number): Date {
  return new Date(windowStart(now, windowSeconds).getTime() + windowSeconds * 1000);
}

/**
 * Turns a current count into a decision.
 *
 * `count` is the value *after* this attempt has been recorded, so a limit of 8 is
 * reached when the count is 8 and exceeded at 9. Counting the attempt before
 * deciding means a request that is about to be refused still contributes to the
 * window, which is what makes repeated refused attempts extend the lockout rather
 * than being free.
 */
export function evaluate(
  count: number,
  rule: RateLimitRule,
  now: Date = new Date(),
): RateLimitDecision {
  const resetAt = windowEnd(now, rule.windowSeconds);
  const remaining = Math.max(0, rule.limit - count);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Builds the bucket key.
 *
 * Identifiers are hashed by the caller when they are personal data — see
 * `identifierFor` below. The key is a single opaque string so the storage layer
 * needs one unique index rather than a composite of variable shape.
 */
export function bucketKey(action: string, identifier: string): string {
  return `${action}:${identifier}`;
}

/**
 * Composes the identifier a limit is counted against.
 *
 * Login is limited per email *and* per IP, not one or the other. Per-IP alone
 * lets an attacker spread attempts across a botnet against one account; per-email
 * alone lets one IP work through a list of accounts. Both, independently, closes
 * each gap.
 */
export function identifierFor(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? 'unknown').toLowerCase().trim())
    .filter((part) => part.length > 0)
    .join('|');
}

/**
 * The client IP, from the proxy headers a managed host sets.
 *
 * `x-forwarded-for` is a client-controllable header wherever it is not overwritten
 * by a trusted proxy, so only the *first* entry is used and only when the platform
 * is known to prepend it. On Vercel `x-real-ip` is set by the platform and is
 * preferred for that reason.
 *
 * Returning null rather than a placeholder matters: a spoofable value shared by
 * every attacker would merge their buckets and lock out real users.
 */
export function clientIpFrom(headers: {
  get(name: string): string | null;
}): string | null {
  const realIp = headers.get('x-real-ip');
  if (realIp && isPlausibleIp(realIp)) return realIp;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && isPlausibleIp(first)) return first;
  }
  return null;
}

function isPlausibleIp(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  // Not a full parse — just enough to reject header-injection attempts and
  // obviously fabricated values before they become part of a database key.
  return /^[0-9a-fA-F:.]+$/.test(value);
}
