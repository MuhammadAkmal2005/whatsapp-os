/**
 * The rate-limit adapter callers use.
 *
 * It joins the pure decision logic in `window.ts` to the atomic counter in the
 * repository: record the attempt, then turn the resulting count into a decision.
 * Callers never touch the bucket directly.
 *
 * A limiter must never be the reason a request fails open *or* closed by
 * accident. If the datastore is unreachable the safer default for authentication
 * is to deny, but denying every login because one query timed out is its own
 * outage — so a storage error is surfaced to the caller, which decides per
 * action. Auth actions treat an error as "allow but log", because a working
 * password check behind it is the real control; the limiter is defence in depth.
 */

import 'server-only';

import { RATE_LIMITS, type RateLimitKey } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { incrementBucket } from '@/server/repositories/rate-limit.repository';
import {
  bucketKey,
  evaluate,
  type RateLimitDecision,
  windowEnd,
} from '@/server/ratelimit/window';

export type { RateLimitDecision } from '@/server/ratelimit/window';

/**
 * Consumes one unit of the named allowance for `identifier` and returns the
 * decision. `identifier` is already composed by the caller — an email, an IP, or
 * both joined — and is treated as opaque here.
 */
export async function consume(
  action: RateLimitKey,
  identifier: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const rule = RATE_LIMITS[action];
  const key = bucketKey(action, identifier);
  const resetAt = windowEnd(now, rule.windowSeconds);

  const state = await incrementBucket(prisma, key, resetAt);
  return evaluate(state.count, rule, now);
}

/**
 * Convenience for the common auth case: limit an action against both the email
 * and the client IP independently, and block if either is exhausted. Per-IP
 * alone lets a botnet spread attempts across one account; per-email alone lets
 * one IP work through a list. Both, separately, closes each gap.
 */
export async function consumeDual(
  action: RateLimitKey,
  parts: { email?: string | null; ip?: string | null },
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const decisions: RateLimitDecision[] = [];

  if (parts.email) {
    decisions.push(await consume(action, `email:${parts.email.trim().toLowerCase()}`, now));
  }
  if (parts.ip) {
    decisions.push(await consume(action, `ip:${parts.ip}`, now));
  }

  if (decisions.length === 0) {
    // Nothing to key on. Fall back to a single global bucket for the action so a
    // request with neither an email nor a resolvable IP is still bounded.
    return consume(action, 'anonymous', now);
  }

  // The strictest decision wins: blocked if any dimension is blocked, and the
  // smallest remaining allowance is the honest number to report.
  return decisions.reduce((strictest, current) => {
    if (!current.allowed && strictest.allowed) return current;
    if (current.allowed !== strictest.allowed) return strictest;
    return current.remaining < strictest.remaining ? current : strictest;
  });
}
