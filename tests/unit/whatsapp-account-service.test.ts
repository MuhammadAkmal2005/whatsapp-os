import { describe, expect, it, vi } from 'vitest';

import { env } from '@/config/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { isAppError, ProviderError } from '@/server/errors';
import { isMetaGraphFailure } from '@/server/services/whatsapp/meta-failure';
import { MetaGraphClient } from '@/server/services/whatsapp/meta-graph.client';
import {
  connectWhatsAppSchema,
  disconnectWhatsAppSchema,
} from '@/server/validation/whatsapp-account';

/** Real `Response` objects, because the client reads headers and bodies, not a duck type. */
function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('WhatsApp Account Validation Schemas', () => {
  it('validates a complete connect payload', () => {
    const result = connectWhatsAppSchema.safeParse({
      wabaId: '109876543210987',
      phoneNumberId: '106540352242922',
      displayPhoneNumber: '+92 300 1234567',
      accessToken: 'EAAG...sample_token',
      displayName: 'Akmal Fashion Support',
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = connectWhatsAppSchema.safeParse({
      wabaId: '',
      phoneNumberId: '',
      displayPhoneNumber: '',
      accessToken: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMap = result.error.flatten().fieldErrors;
      expect(errorMap.wabaId).toBeDefined();
      expect(errorMap.phoneNumberId).toBeDefined();
      expect(errorMap.displayPhoneNumber).toBeDefined();
      expect(errorMap.accessToken).toBeDefined();
    }
  });

  it('validates disconnect schema with UUID', () => {
    const valid = disconnectWhatsAppSchema.safeParse({
      accountId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
    expect(valid.success).toBe(true);

    const invalid = disconnectWhatsAppSchema.safeParse({
      accountId: 'not-a-uuid',
    });
    expect(invalid.success).toBe(false);
  });
});

describe('MetaGraphClient phone number read', () => {
  it('normalises Meta phone fields into our summary shape', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: '106540352242922',
        display_phone_number: '+92 300 1234567',
        verified_name: 'Akmal Official',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
        platform_type: 'CLOUD_API',
        throughput: { level: 'STANDARD' },
      }),
    );

    const client = new MetaGraphClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const summary = await client.getPhoneNumber({
      phoneNumberId: '106540352242922',
      accessToken: 'EAAG_valid_test_token_long_enough',
    });

    expect(summary).toEqual({
      id: '106540352242922',
      displayPhoneNumber: '+92 300 1234567',
      verifiedName: 'Akmal Official',
      qualityRating: 'GREEN',
      codeVerificationStatus: 'VERIFIED',
      platformType: 'CLOUD_API',
      throughputLevel: 'STANDARD',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/106540352242922?fields=');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAG_valid_test_token_long_enough',
    );
  });

  it('redacts a token Meta reflects back in a 401 error message', async () => {
    const secretToken = 'EAAG_super_secret_token_1234567890';
    const mockFetch = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: `Invalid OAuth access token ${secretToken}`,
            type: 'OAuthException',
            code: 190,
          },
        },
        { status: 401 },
      ),
    );

    const client = new MetaGraphClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const attempt = client.getPhoneNumber({
      phoneNumberId: '106540352242922',
      accessToken: secretToken,
    });

    await expect(attempt).rejects.toBeInstanceOf(ProviderError);
    const error = await attempt.catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(secretToken);
    expect(String(error)).toContain('[REDACTED]');
  });

  it('redacts a secret that does not look like a Meta token', async () => {
    // The belt-and-braces `EAA…` pattern cannot catch this one, so a pass here proves
    // the per-call secrets list is doing the work rather than the regex.
    const secretToken = 'shop_token_without_meta_prefix_98765';
    const mockFetch = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: `Bad token: ${secretToken}`, code: 190 } },
        { status: 401 },
      ),
    );

    const client = new MetaGraphClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const error = await client
      .getPhoneNumber({ phoneNumberId: '106540352242922', accessToken: secretToken })
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(secretToken);
  });

  it('reports a refused connection as provably never sent', async () => {
    // The distinction the whole retry story rests on: this failure is safe to retry,
    // because the request never left the process.
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const mockFetch = vi.fn().mockRejectedValueOnce(refused);

    const client = new MetaGraphClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const error = await client
      .getPhoneNumber({ phoneNumberId: '106540352242922', accessToken: 'token_value_1234' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    if (!isAppError(error) || !isMetaGraphFailure(error.cause)) {
      throw new Error('transport failure record missing from error cause');
    }
    expect(error.cause.kind).toBe('transport');
    expect(error.cause.transportCode).toBe('ECONNREFUSED');
    expect(error.cause.requestPossiblySent).toBe(false);
  });

  it('reports a timeout as possibly sent', async () => {
    const timedOut = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const mockFetch = vi.fn().mockRejectedValueOnce(timedOut);

    const client = new MetaGraphClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const error = await client
      .getPhoneNumber({ phoneNumberId: '106540352242922', accessToken: 'token_value_1234' })
      .catch((caught: unknown) => caught);

    if (!isAppError(error) || !isMetaGraphFailure(error.cause)) {
      throw new Error('transport failure record missing from error cause');
    }
    expect(error.cause.transportCode).toBe('ABORT_ERR');
    expect(error.cause.requestPossiblySent).toBe(true);
  });
});

describe('Token Encryption & Decryption Invariants', () => {
  it('encrypts access token with version prefix and allows round-trip decryption with AUTH_SECRET', () => {
    const rawToken = 'EAAG_test_system_user_token_long_string_1234567890';
    const encrypted = encryptSecret(rawToken, env.AUTH_SECRET);

    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted).not.toContain(rawToken);

    const decrypted = decryptSecret(encrypted, env.AUTH_SECRET);
    expect(decrypted).toBe(rawToken);
  });
});
