/**
 * Session token generation and lifetime rules.
 *
 * The pattern is Lucia's: an opaque random token goes to the browser in an
 * httpOnly cookie, and only its SHA-256 digest is stored. A stolen database dump
 * therefore contains no usable session — the digest cannot be replayed.
 *
 * A JWT would avoid the lookup, but a stateless token cannot be revoked, and
 * "sign this user out of every device now" is a requirement for a product holding
 * a business's entire customer list. One indexed primary-key read per request is
 * a fair price for revocability.
 *
 * Pure `node:crypto`, so the lifetime arithmetic is directly unit-testable.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes = 256 bits. Guessing is not a threat model at this size. */
const TOKEN_BYTES = 32;

export const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * When less than half the lifetime remains, the session is extended on use.
 *
 * Renewing on every request would write to the database on every page view. Never
 * renewing would sign out an active user mid-task at exactly 30 days. Half-life
 * renewal gives a session that stays alive while in use and expires promptly once
 * abandoned, at roughly one write per fortnight.
 */
export const RENEWAL_THRESHOLD = 0.5;

/**
 * Base64url without padding. URL- and cookie-safe, and marginally denser than the
 * base32 used for human-readable tokens elsewhere — nobody reads a session token
 * aloud.
 */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The database key for a token.
 *
 * SHA-256 rather than scrypt: the input is already 256 bits of uniform
 * randomness, so there is no dictionary to slow down, and this runs on every
 * authenticated request.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type SessionLifetime = {
  createdAt: Date;
  expiresAt: Date;
};

export function createSessionLifetime(
  now: Date = new Date(),
  durationMs: number = DEFAULT_SESSION_DURATION_MS,
): SessionLifetime {
  return {
    createdAt: now,
    expiresAt: new Date(now.getTime() + durationMs),
  };
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function shouldRenew(
  expiresAt: Date,
  now: Date = new Date(),
  durationMs: number = DEFAULT_SESSION_DURATION_MS,
): boolean {
  if (isExpired(expiresAt, now)) return false;
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining < durationMs * RENEWAL_THRESHOLD;
}

export function renewedExpiry(
  now: Date = new Date(),
  durationMs: number = DEFAULT_SESSION_DURATION_MS,
): Date {
  return new Date(now.getTime() + durationMs);
}

export type SessionValidation =
  | { state: 'valid'; renew: false }
  | { state: 'valid'; renew: true; expiresAt: Date }
  | { state: 'expired' };

/**
 * The single decision point for an existing session: still good, good but due for
 * extension, or over. Keeping it here rather than in the service means the
 * boundary conditions are testable without a database.
 */
export function validateSessionLifetime(
  expiresAt: Date,
  now: Date = new Date(),
  durationMs: number = DEFAULT_SESSION_DURATION_MS,
): SessionValidation {
  if (isExpired(expiresAt, now)) return { state: 'expired' };
  if (shouldRenew(expiresAt, now, durationMs)) {
    return { state: 'valid', renew: true, expiresAt: renewedExpiry(now, durationMs) };
  }
  return { state: 'valid', renew: false };
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Sessions are looked up by digest, so this is not strictly on the critical path
 * — but invite and password-reset tokens are compared after being fetched by
 * user, and there a variable-time compare would leak the stored value one byte at
 * a time.
 */
export function tokenDigestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ── Single-use tokens (email verification, password reset, invites) ────────

/** Short-lived by design; a reset link that works for a week is a standing key to
 *  the account sitting in an inbox. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateSingleUseToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function expiryFrom(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}
