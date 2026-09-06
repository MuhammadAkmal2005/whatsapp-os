/**
 * Cryptographic helpers, built only on `node:crypto`.
 *
 * No third-party dependency touches a secret in this codebase. That is a
 * deliberate reduction of supply-chain surface: a compromised transitive
 * dependency in a hashing library would be able to exfiltrate every password it
 * saw, and the standard library primitives are sufficient for everything we
 * need.
 *
 * Server-only in practice, but importable by tests without a bundler.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

// ── Random values ──────────────────────────────────────────────────────────

/**
 * Crockford base32 without padding. Chosen over base64url for values a human
 * might have to read or retype — no case sensitivity, and the ambiguous
 * characters I, L, O and U are excluded.
 */
const BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** A CSPRNG token of `byteLength` bytes, base32-encoded. */
export function generateToken(byteLength = 32): string {
  return encodeBase32(randomBytes(byteLength));
}

export function generateHexToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * A digit string of `length`, uniformly random.
 *
 * `randomInt` per digit rather than a modulo over `randomBytes`: modulo over 256 skews
 * towards the low digits, and this is used for the PIN that gates re-registering a
 * WhatsApp number with Meta, where a predictable value is a real weakness.
 */
export function generateNumericPin(length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String(randomInt(0, 10));
  }
  return value;
}

// ── Hashing ────────────────────────────────────────────────────────────────

/**
 * SHA-256, hex-encoded. Used for session and invite token lookup — the plaintext
 * token goes to the client and only this digest is stored, so a database dump on
 * its own cannot be replayed as a valid session.
 *
 * A fast hash is correct here and would be wrong for passwords. The input is 256
 * bits of uniform randomness, so there is no dictionary to attack and no benefit
 * to slowing the lookup down. Passwords, which are low-entropy, use scrypt.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sha256Bytes(input: Buffer | Uint8Array): Buffer {
  return createHash('sha256').update(input).digest();
}

// ── Constant-time comparison ───────────────────────────────────────────────

/**
 * Compares two strings without leaking their contents through timing.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length.
 * Hashing both sides first makes every comparison fixed-width, so the function
 * is safe for inputs of differing and attacker-controlled length.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

export function safeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── HMAC ───────────────────────────────────────────────────────────────────

/**
 * Hex HMAC-SHA256. Meta signs webhook bodies this way, and the digest must be
 * computed over the exact bytes received — see `services/whatsapp/signature.ts`
 * for why the raw body must not be re-serialised first.
 */
export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmacSha256(
  secret: string,
  payload: string | Buffer,
  expectedHex: string,
): boolean {
  const computed = hmacSha256Hex(secret, payload);
  // Both are fixed-length hex digests, so a direct timing-safe compare is fine.
  if (computed.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(expectedHex, 'utf8'));
}

// ── Symmetric encryption for stored provider credentials ───────────────────

const ENCRYPTION_VERSION = 'v1';
const AES_KEY_LENGTH = 32;
const GCM_IV_LENGTH = 12; // 96 bits, the size AES-GCM is specified for
const KEY_DERIVATION_SALT = 'whatsapp-os:token-encryption:v1';

/**
 * Derives the encryption key from `AUTH_SECRET`. The salt is a fixed domain
 * separator rather than a random value: the key must be reproducible across
 * processes and restarts, and the secret itself supplies the entropy.
 */
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, KEY_DERIVATION_SALT, AES_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
  });
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function keyFor(secret: string): Buffer {
  // Key derivation is intentionally slow, so deriving it per call would make
  // every WhatsApp send pay for it.
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = deriveKey(secret);
  cachedKey = { secret, key };
  return key;
}

/**
 * AES-256-GCM. Authenticated encryption, so a tampered ciphertext fails to
 * decrypt rather than silently yielding garbage that gets sent to Meta as an
 * access token.
 *
 * Output format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. The version prefix
 * means the scheme can be rotated without a migration guessing game.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(encoded: string, secret: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Malformed encrypted value: unrecognised format or version.');
  }

  const [, ivB64, tagB64, ciphertextB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
