import { describe, expect, it } from 'vitest';

import { RATE_LIMITS } from '@/config/constants';
import {
  bucketKey,
  clientIpFrom,
  evaluate,
  identifierFor,
  windowEnd,
  windowStart,
} from '@/server/ratelimit/window';

const RULE = { limit: 8, windowSeconds: 300 } as const;

describe('window alignment', () => {
  it('aligns to absolute time, not to first use', () => {
    // Every process agrees on the boundary without coordination, and a restart
    // cannot mint a fresh allowance.
    const a = windowStart(new Date('2026-08-26T10:03:17.412Z'), 300);
    const b = windowStart(new Date('2026-08-26T10:04:59.999Z'), 300);
    expect(a.toISOString()).toBe('2026-08-26T10:00:00.000Z');
    expect(a.getTime()).toBe(b.getTime());
  });

  it('moves to the next window at the boundary', () => {
    expect(windowStart(new Date('2026-08-26T10:05:00.000Z'), 300).toISOString()).toBe(
      '2026-08-26T10:05:00.000Z',
    );
  });

  it('computes the window end', () => {
    expect(windowEnd(new Date('2026-08-26T10:03:00.000Z'), 300).toISOString()).toBe(
      '2026-08-26T10:05:00.000Z',
    );
  });

  it('rejects a nonsensical window', () => {
    for (const windowSeconds of [0, -1, 1.5, Number.NaN]) {
      expect(() => windowStart(new Date(), windowSeconds)).toThrow();
    }
  });
});

describe('limit evaluation', () => {
  const now = new Date('2026-08-26T10:03:00.000Z');

  it('allows attempts up to and including the limit', () => {
    for (let count = 1; count <= RULE.limit; count += 1) {
      expect(evaluate(count, RULE, now).allowed).toBe(true);
    }
  });

  it('refuses the attempt after the limit', () => {
    expect(evaluate(RULE.limit + 1, RULE, now).allowed).toBe(false);
  });

  it('reports the remaining allowance', () => {
    expect(evaluate(1, RULE, now).remaining).toBe(7);
    expect(evaluate(8, RULE, now).remaining).toBe(0);
  });

  it('never reports a negative remaining allowance', () => {
    expect(evaluate(500, RULE, now).remaining).toBe(0);
  });

  it('reports a retry-after that lands on the window boundary', () => {
    const decision = evaluate(99, RULE, now);
    expect(decision.resetAt.toISOString()).toBe('2026-08-26T10:05:00.000Z');
    expect(decision.retryAfterSeconds).toBe(120);
  });

  it('never reports a retry-after of zero', () => {
    // A Retry-After of 0 invites an immediate retry, which defeats the limit.
    const atBoundary = new Date('2026-08-26T10:04:59.999Z');
    expect(evaluate(99, RULE, atBoundary).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe('bucket identity', () => {
  it('separates actions so one limit cannot exhaust another', () => {
    expect(bucketKey('login', 'a@b.com')).not.toBe(bucketKey('signup', 'a@b.com'));
  });

  /**
   * Login is limited per email and per IP independently. Per-IP alone lets a
   * botnet spread attempts against one account; per-email alone lets one host work
   * through a list of accounts.
   */
  it('keeps the per-email and per-IP buckets distinct', () => {
    const byEmail = bucketKey('login', identifierFor(['ahmed@example.com']));
    const byIp = bucketKey('login', identifierFor(['203.0.113.7']));
    expect(byEmail).not.toBe(byIp);
  });

  it('normalises case so casing cannot multiply the allowance', () => {
    expect(identifierFor(['Ahmed@Example.COM'])).toBe(identifierFor(['ahmed@example.com']));
  });

  it('trims whitespace for the same reason', () => {
    expect(identifierFor([' ahmed@example.com '])).toBe('ahmed@example.com');
  });

  it('substitutes a placeholder for a missing part rather than collapsing the key', () => {
    expect(identifierFor(['ahmed@example.com', null])).toBe('ahmed@example.com|unknown');
  });
});

describe('client IP extraction', () => {
  const headersOf = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it('prefers the platform-set header', () => {
    expect(
      clientIpFrom(headersOf({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })),
    ).toBe('203.0.113.7');
  });

  it('falls back to the first forwarded-for entry', () => {
    expect(clientIpFrom(headersOf({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
  });

  it('handles IPv6', () => {
    expect(clientIpFrom(headersOf({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  /**
   * Returning null rather than a placeholder is the safe failure: a spoofable
   * value shared by every attacker would merge their buckets and lock out real
   * users along with them.
   */
  it('returns null for a header that is not an address', () => {
    for (const hostile of ['', 'not-an-ip', '<script>', '198.51.100.1; DROP TABLE', 'a'.repeat(60)]) {
      expect(clientIpFrom(headersOf({ 'x-real-ip': hostile, 'x-forwarded-for': hostile }))).toBeNull();
    }
  });

  it('returns null when no header is present', () => {
    expect(clientIpFrom(headersOf({}))).toBeNull();
  });
});

describe('configured limits are defensible', () => {
  it('keeps login attempts low enough to blunt credential stuffing', () => {
    expect(RATE_LIMITS.login.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.login.windowSeconds).toBeGreaterThanOrEqual(60);
  });

  it('caps AI requests per user and per workspace', () => {
    // Instruction #103: one user must not be able to generate unlimited AI spend.
    expect(RATE_LIMITS.aiRequestPerUser.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.aiRequestPerWorkspace.limit).toBeGreaterThan(
      RATE_LIMITS.aiRequestPerUser.limit,
    );
  });

  it('gives every configured limit a positive limit and window', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowSeconds, name).toBeGreaterThan(0);
    }
  });
});
