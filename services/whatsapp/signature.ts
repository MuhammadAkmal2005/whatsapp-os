/**
 * Meta webhook signature verification.
 *
 * Meta signs each webhook body with the app secret and sends the digest in
 * `X-Hub-Signature-256` as `sha256=<hex>`. Without this check, the webhook
 * endpoint is an unauthenticated write API: anyone who learns the URL could inject
 * messages into a business's inbox, fabricate delivery receipts, or drive AI spend.
 *
 * The critical detail is that the digest must be computed over the exact bytes
 * received. `JSON.parse` followed by `JSON.stringify` reorders keys, changes
 * whitespace, and re-encodes non-ASCII escapes — all of which change the digest.
 * Urdu product names make that failure routine rather than theoretical. So the
 * route reads the raw body, verifies it, and only then parses.
 *
 * Only `node:crypto`, so it is directly testable.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const HEX_DIGEST_LENGTH = 64;

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'malformed' | 'mismatch' };

/**
 * Verifies `X-Hub-Signature-256` against the raw request body.
 *
 * `rawBody` must be the bytes as received. Passing a re-serialised object will
 * produce spurious mismatches.
 *
 * The failure reason is for the server log only. The endpoint returns an
 * undifferentiated 401 — telling a caller *why* their forgery failed is free help
 * for the next attempt.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): SignatureResult {
  if (!signatureHeader) return { valid: false, reason: 'missing' };
  if (!appSecret) return { valid: false, reason: 'missing' };

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { valid: false, reason: 'malformed' };
  }

  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (provided.length !== HEX_DIGEST_LENGTH || !/^[0-9a-f]+$/.test(provided)) {
    return { valid: false, reason: 'malformed' };
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  // Both sides are now known to be 64 lowercase hex characters, so the lengths
  // match and `timingSafeEqual` cannot throw.
  const matches = timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );

  return matches ? { valid: true } : { valid: false, reason: 'mismatch' };
}

/** Test and development helper for producing a valid header. Never used to sign
 *  anything we send — Meta signs inbound traffic, not us. */
export function signWebhookBody(rawBody: Buffer | string, appSecret: string): string {
  return `${SIGNATURE_PREFIX}${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

// ── Webhook verification handshake (GET) ───────────────────────────────────

export type VerificationResult =
  | { verified: true; challenge: string }
  | { verified: false };

/**
 * The one-time subscription handshake. Meta calls the endpoint with
 * `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`; we echo the
 * challenge back only if the token matches the one we configured.
 */
export function verifySubscription(
  params: {
    mode: string | null | undefined;
    token: string | null | undefined;
    challenge: string | null | undefined;
  },
  expectedToken: string,
): VerificationResult {
  if (params.mode !== 'subscribe') return { verified: false };
  if (!params.token || !params.challenge || !expectedToken) return { verified: false };

  // Constant-time: the verify token is a shared secret, and a variable-time
  // compare would let it be recovered one character at a time.
  const provided = Buffer.from(params.token, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  if (provided.length !== expected.length) return { verified: false };
  if (!timingSafeEqual(provided, expected)) return { verified: false };

  return { verified: true, challenge: params.challenge };
}
