import { describe, expect, it } from 'vitest';

import {
  createSessionLifetime,
  DEFAULT_SESSION_DURATION_MS,
  EMAIL_VERIFICATION_TTL_MS,
  expiryFrom,
  generateSessionToken,
  generateSingleUseToken,
  hashSessionToken,
  INVITE_TTL_MS,
  isExpired,
  PASSWORD_RESET_TTL_MS,
  renewedExpiry,
  RENEWAL_THRESHOLD,
  shouldRenew,
  tokenDigestsMatch,
  validateSessionLifetime,
} from '@/server/auth/session-token';

describe('session token generation', () => {
  it('produces a cookie-safe token', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces 256 bits of entropy', () => {
    // 32 bytes base64url, unpadded, is 43 characters.
    expect(generateSessionToken()).toHaveLength(43);
  });

  it('never repeats across a large sample', () => {
    const tokens = new Set(Array.from({ length: 2000 }, generateSessionToken));
    expect(tokens.size).toBe(2000);
  });
});

describe('session token hashing', () => {
  /**
   * The property that makes a stolen database dump useless: what is stored is not
   * what the browser holds.
   */
  it('stores a digest that is not the token', () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);
    expect(digest).not.toBe(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, so the digest can be a lookup key', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('gives different digests for different tokens', () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });

  it('is sensitive to a single character change', () => {
    const token = generateSessionToken();
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(hashSessionToken(tampered)).not.toBe(hashSessionToken(token));
  });
});

describe('session lifetime', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');

  it('expires 30 days out by default', () => {
    const lifetime = createSessionLifetime(now);
    expect(lifetime.expiresAt.getTime() - now.getTime()).toBe(DEFAULT_SESSION_DURATION_MS);
    expect(DEFAULT_SESSION_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('treats the exact expiry instant as expired', () => {
    // Inclusive rather than exclusive: a session valid "up to and including" its
    // expiry is a session that lives one tick longer than the database believes.
    const expiresAt = new Date(now.getTime());
    expect(isExpired(expiresAt, now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isExpired(new Date(now.getTime() - 1), now)).toBe(true);
  });
});

describe('sliding renewal', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const halfLife = DEFAULT_SESSION_DURATION_MS * RENEWAL_THRESHOLD;

  it('does not renew a fresh session', () => {
    const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_DURATION_MS);
    expect(shouldRenew(expiresAt, now)).toBe(false);
  });

  it('renews once past the half-life', () => {
    const justInside = new Date(now.getTime() + halfLife - 1);
    const justOutside = new Date(now.getTime() + halfLife + 1);
    expect(shouldRenew(justInside, now)).toBe(true);
    expect(shouldRenew(justOutside, now)).toBe(false);
  });

  it('does not renew an already expired session', () => {
    // Renewing here would resurrect a dead session — the whole point of expiry.
    expect(shouldRenew(new Date(now.getTime() - 1), now)).toBe(false);
  });

  it('extends by a full duration from now, not from the old expiry', () => {
    const renewed = renewedExpiry(now);
    expect(renewed.getTime() - now.getTime()).toBe(DEFAULT_SESSION_DURATION_MS);
  });
});

describe('validateSessionLifetime', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');

  it('reports a fresh session as valid without a write', () => {
    const result = validateSessionLifetime(
      new Date(now.getTime() + DEFAULT_SESSION_DURATION_MS),
      now,
    );
    expect(result).toEqual({ state: 'valid', renew: false });
  });

  it('reports a half-spent session as valid with a new expiry', () => {
    const result = validateSessionLifetime(new Date(now.getTime() + 1000), now);
    expect(result.state).toBe('valid');
    if (result.state === 'valid' && result.renew) {
      expect(result.expiresAt.getTime()).toBe(now.getTime() + DEFAULT_SESSION_DURATION_MS);
    } else {
      expect.fail('expected a renewing result');
    }
  });

  it('reports an expired session as expired', () => {
    expect(validateSessionLifetime(new Date(now.getTime() - 1), now)).toEqual({
      state: 'expired',
    });
  });

  it('honours a custom duration', () => {
    const oneHour = 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + oneHour);
    expect(validateSessionLifetime(expiresAt, now, oneHour)).toEqual({
      state: 'valid',
      renew: false,
    });
    const halfSpent = new Date(now.getTime() + oneHour / 4);
    expect(validateSessionLifetime(halfSpent, now, oneHour).state).toBe('valid');
    expect(
      validateSessionLifetime(halfSpent, now, oneHour) as { renew: boolean },
    ).toEqual({ state: 'valid', renew: true, expiresAt: new Date(now.getTime() + oneHour) });
  });
});

describe('constant-time digest comparison', () => {
  it('matches identical digests', () => {
    const digest = hashSessionToken('token');
    expect(tokenDigestsMatch(digest, digest)).toBe(true);
  });

  it('rejects different digests', () => {
    expect(tokenDigestsMatch(hashSessionToken('a'), hashSessionToken('b'))).toBe(false);
  });

  it('returns false on a length mismatch rather than throwing', () => {
    // timingSafeEqual throws on unequal lengths; that must not become a 500.
    expect(tokenDigestsMatch('abc', hashSessionToken('a'))).toBe(false);
    expect(tokenDigestsMatch('', '')).toBe(true);
  });
});

describe('single-use token lifetimes', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');

  it('keeps a password reset link short-lived', () => {
    // A reset link sitting in an inbox is a standing key to the account.
    expect(PASSWORD_RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(expiryFrom(PASSWORD_RESET_TTL_MS, now).getTime()).toBe(now.getTime() + 3_600_000);
  });

  it('gives email verification a day and invites a week', () => {
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('generates single-use tokens with full entropy', () => {
    expect(generateSingleUseToken()).toHaveLength(43);
    const tokens = new Set(Array.from({ length: 500 }, generateSingleUseToken));
    expect(tokens.size).toBe(500);
  });
});
