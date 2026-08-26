import { describe, expect, it } from 'vitest';

import {
  signWebhookBody,
  verifySubscription,
  verifyWebhookSignature,
} from '@/services/whatsapp/signature';

const APP_SECRET = 'test-app-secret-not-a-real-value';

const SAMPLE_BODY = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
            messages: [
              {
                from: '923001234567',
                id: 'wamid.HBgMOTIzMDAxMjM0NTY3FQIAEhgUM0E0QkNERUY=',
                timestamp: '1756200000',
                type: 'text',
                text: { body: 'black kurta XL available hai?' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
});

describe('webhook signature verification', () => {
  it('accepts a correctly signed body', () => {
    const signature = signWebhookBody(SAMPLE_BODY, APP_SECRET);
    expect(verifyWebhookSignature(SAMPLE_BODY, signature, APP_SECRET)).toEqual({ valid: true });
  });

  /**
   * Without this check the webhook endpoint is an unauthenticated write API:
   * anyone who learns the URL could inject messages into a business's inbox,
   * fabricate delivery receipts, or drive AI spend.
   */
  it('rejects an unsigned request', () => {
    expect(verifyWebhookSignature(SAMPLE_BODY, null, APP_SECRET)).toEqual({
      valid: false,
      reason: 'missing',
    });
    expect(verifyWebhookSignature(SAMPLE_BODY, undefined, APP_SECRET)).toEqual({
      valid: false,
      reason: 'missing',
    });
  });

  it('rejects a body signed with the wrong secret', () => {
    const forged = signWebhookBody(SAMPLE_BODY, 'attacker-guessed-secret');
    expect(verifyWebhookSignature(SAMPLE_BODY, forged, APP_SECRET)).toEqual({
      valid: false,
      reason: 'mismatch',
    });
  });

  it('rejects a body altered after signing', () => {
    const signature = signWebhookBody(SAMPLE_BODY, APP_SECRET);
    const tampered = SAMPLE_BODY.replace('black kurta XL', 'send me a refund');
    expect(verifyWebhookSignature(tampered, signature, APP_SECRET).valid).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    for (const header of [
      '',
      'sha1=abcdef',
      'abcdef',
      'sha256=',
      'sha256=nothex!!',
      `sha256=${'a'.repeat(63)}`,
      `sha256=${'a'.repeat(65)}`,
    ]) {
      const result = verifyWebhookSignature(SAMPLE_BODY, header, APP_SECRET);
      expect(result.valid).toBe(false);
    }
  });

  it('accepts an upper-case hex digest', () => {
    const signature = signWebhookBody(SAMPLE_BODY, APP_SECRET).toUpperCase();
    // Only the digest is case-insensitive; the prefix must still be `sha256=`.
    const normalised = `sha256=${signature.slice('SHA256='.length)}`;
    expect(verifyWebhookSignature(SAMPLE_BODY, normalised, APP_SECRET).valid).toBe(true);
  });

  it('refuses to verify when no app secret is configured', () => {
    // Fail closed. An empty secret must never mean "accept everything".
    const signature = signWebhookBody(SAMPLE_BODY, '');
    expect(verifyWebhookSignature(SAMPLE_BODY, signature, '').valid).toBe(false);
  });

  /**
   * The reason this is verified over raw bytes rather than a re-serialised object.
   * Urdu and Roman Urdu product names make key ordering and escape encoding differ
   * between the bytes Meta signed and anything we produce from the parsed object,
   * so a re-serialising implementation would fail on real traffic while passing an
   * ASCII test.
   */
  it('verifies a body containing Urdu text byte-for-byte', () => {
    const urduBody = JSON.stringify({
      text: { body: 'کالا کرتا ایکس ایل دستیاب ہے؟' },
      note: 'bhai price kya hai?',
    });
    const signature = signWebhookBody(urduBody, APP_SECRET);
    expect(verifyWebhookSignature(urduBody, signature, APP_SECRET).valid).toBe(true);

    // Re-serialising the parsed object changes the bytes and breaks the digest.
    const reSerialised = JSON.stringify(JSON.parse(urduBody), ['note', 'text']);
    expect(verifyWebhookSignature(reSerialised, signature, APP_SECRET).valid).toBe(false);
  });

  it('verifies a Buffer body identically to the equivalent string', () => {
    const buffer = Buffer.from(SAMPLE_BODY, 'utf8');
    const signature = signWebhookBody(buffer, APP_SECRET);
    expect(verifyWebhookSignature(buffer, signature, APP_SECRET).valid).toBe(true);
    expect(verifyWebhookSignature(SAMPLE_BODY, signature, APP_SECRET).valid).toBe(true);
  });

  it('never throws, whatever the header contains', () => {
    for (const header of ['sha256=' + '\u0000'.repeat(64), 'sha256=🙂'.repeat(10), 'sha256']) {
      expect(() => verifyWebhookSignature(SAMPLE_BODY, header, APP_SECRET)).not.toThrow();
    }
  });
});

describe('subscription handshake', () => {
  const VERIFY_TOKEN = 'configured-verify-token';

  it('echoes the challenge when the token matches', () => {
    expect(
      verifySubscription(
        { mode: 'subscribe', token: VERIFY_TOKEN, challenge: '1158201444' },
        VERIFY_TOKEN,
      ),
    ).toEqual({ verified: true, challenge: '1158201444' });
  });

  it('refuses a wrong token', () => {
    expect(
      verifySubscription(
        { mode: 'subscribe', token: 'wrong-token-entirely', challenge: '1158201444' },
        VERIFY_TOKEN,
      ),
    ).toEqual({ verified: false });
  });

  it('refuses a token that is a prefix of the real one', () => {
    // The length check must not be a way to pass with a partial guess.
    expect(
      verifySubscription(
        { mode: 'subscribe', token: VERIFY_TOKEN.slice(0, -1), challenge: 'x' },
        VERIFY_TOKEN,
      ),
    ).toEqual({ verified: false });
  });

  it('refuses a mode other than subscribe', () => {
    expect(
      verifySubscription({ mode: 'unsubscribe', token: VERIFY_TOKEN, challenge: 'x' }, VERIFY_TOKEN),
    ).toEqual({ verified: false });
  });

  it('refuses a missing parameter', () => {
    expect(verifySubscription({ mode: 'subscribe', token: null, challenge: 'x' }, VERIFY_TOKEN))
      .toEqual({ verified: false });
    expect(verifySubscription({ mode: 'subscribe', token: VERIFY_TOKEN, challenge: null }, VERIFY_TOKEN))
      .toEqual({ verified: false });
  });

  it('refuses when no verify token is configured', () => {
    expect(verifySubscription({ mode: 'subscribe', token: '', challenge: 'x' }, '')).toEqual({
      verified: false,
    });
  });
});
