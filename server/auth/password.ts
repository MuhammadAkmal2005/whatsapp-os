/**
 * Password hashing and verification.
 *
 * scrypt from `node:crypto`. Argon2id would be a marginally stronger choice, but
 * every Node binding for it is a native module, and a native module in this
 * dependency tree means a compiler toolchain in every build environment and a
 * class of install failure that has nothing to do with our code. scrypt is
 * memory-hard, is in the standard library, and remains an accepted choice under
 * OWASP's password storage guidance. The cost parameters are stored per hash, so
 * moving to something else later is a rehash-on-login, not a migration.
 *
 * Only `node:crypto`, so this is directly unit-testable.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * N = 65536 (2^16), r = 8, p = 1 — roughly 64 MiB and ~100 ms on a small server
 * instance. Node's default `maxmem` is 32 MiB, which this exceeds, so the limit
 * is raised explicitly; without it scrypt throws rather than degrading.
 */
const DEFAULT_PARAMS = { N: 65_536, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Memory used is roughly 128 * N * r bytes; the headroom factor keeps Node from
 *  rejecting a request that is exactly at the boundary. */
function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

export type ScryptParams = { N: number; r: number; p: number };

/**
 * Encoded as `scrypt$N$r$p$salt$hash`, salt and hash base64.
 *
 * Self-describing on purpose. A bare hash with parameters read from config
 * becomes unverifiable the moment the config changes; carrying them per record
 * means old hashes keep working and can be upgraded lazily.
 */
const ENCODING_PREFIX = 'scrypt';

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(normalise(password), salt, KEY_LENGTH, {
    ...params,
    maxmem: maxmemFor(params.N, params.r),
  });

  return [
    ENCODING_PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false for a malformed hash rather than throwing. A corrupted row
 * should fail the login, not surface a 500 that tells an attacker they found
 * something unusual about that account.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseEncoded(encoded);
  if (!parsed) return false;

  try {
    const derived = await scrypt(normalise(password), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: maxmemFor(parsed.N, parsed.r),
    });
    if (derived.length !== parsed.hash.length) return false;
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than we now use, so
 * the caller can transparently rehash during a successful login.
 */
export function needsRehash(encoded: string, params: ScryptParams = DEFAULT_PARAMS): boolean {
  const parsed = parseEncoded(encoded);
  if (!parsed) return true;
  return parsed.N < params.N || parsed.r < params.r || parsed.p < params.p;
}

/**
 * Burns the same work as a real verification against a throwaway hash.
 *
 * Called when the email does not exist. Without it, a missing account returns in
 * a millisecond while an existing one takes a hundred, and that difference is a
 * reliable account-enumeration oracle over the network.
 */
export async function fakeVerify(params: ScryptParams = DEFAULT_PARAMS): Promise<void> {
  await scrypt('timing-equalisation', randomBytes(SALT_LENGTH), KEY_LENGTH, {
    ...params,
    maxmem: maxmemFor(params.N, params.r),
  });
}

/**
 * Unicode-normalises to NFKC before hashing.
 *
 * Two visually identical passwords can be different byte sequences — a composed
 * "é" versus "e" plus a combining accent. Someone who sets their password on
 * macOS and types it on Windows would otherwise be locked out. Normalising at
 * both hash and verify time makes the comparison canonical.
 */
function normalise(password: string): string {
  return password.normalize('NFKC');
}

type ParsedHash = ScryptParams & { salt: Buffer; hash: Buffer };

function parseEncoded(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6) return null;

  const [prefix, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (prefix !== ENCODING_PREFIX) return null;

  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 1024 || r < 1 || p < 1) return null;

  // An attacker who could write to the hash column could otherwise set N absurdly
  // high and turn one login attempt into a memory-exhaustion denial of service.
  if (N > 1_048_576 || r > 32 || p > 16) return null;

  const salt = Buffer.from(saltB64, 'base64');
  const hash = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || hash.length < 32) return null;

  return { N, r, p, salt, hash };
}

// ── Password policy ────────────────────────────────────────────────────────

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * A short list of passwords that pass a length check but are the first thing
 * tried in any credential-stuffing run. Not a substitute for a breach corpus —
 * that belongs behind a service call — but it costs nothing and stops the worst
 * choices.
 */
const OBVIOUS_PASSWORDS = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmein12345',
  'whatsappbusiness',
  'iloveyou1234',
]);

export type PasswordCheck = { valid: true } | { valid: false; reason: string };

export function checkPasswordStrength(password: string, email?: string): PasswordCheck {
  const normalised = normalise(password);

  if (normalised.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase you will remember works well.`,
    };
  }
  // Long inputs are rejected rather than truncated: truncating silently makes the
  // stored secret shorter than the user believes it is.
  if (normalised.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, reason: `Keep it under ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (OBVIOUS_PASSWORDS.has(normalised.toLowerCase())) {
    return { valid: false, reason: 'This password is too common. Please choose something else.' };
  }
  if (/^(.)\1+$/.test(normalised)) {
    return { valid: false, reason: 'Please use more than one repeated character.' };
  }

  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && normalised.toLowerCase().includes(localPart)) {
    return { valid: false, reason: 'Please do not use your email address in your password.' };
  }

  // No character-class requirement. Length is what buys entropy; class rules push
  // people toward "Password1!" and then toward writing it on a sticky note.
  return { valid: true };
}
