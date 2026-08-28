import { describe, expect, it, vi } from 'vitest';

import { env } from '@/config/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { ValidationError } from '@/server/errors';
import { validateMetaCredentials } from '@/server/services/whatsapp/whatsapp-account.service';
import {
  connectWhatsAppSchema,
  disconnectWhatsAppSchema,
} from '@/server/validation/whatsapp-account';

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

describe('Live Meta Credential Validation Helper', () => {
  it('returns verified phone details on 200 OK from Meta', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verified_name: 'Akmal Official',
        display_phone_number: '+92 300 1234567',
        quality_rating: 'GREEN',
      }),
    });

    const result = await validateMetaCredentials({
      phoneNumberId: '106540352242922',
      accessToken: 'EAAG_valid_test_token',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.verifiedName).toBe('Akmal Official');
    expect(result.displayPhoneNumber).toBe('+92 300 1234567');
    expect(result.qualityRating).toBe('GREEN');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/106540352242922?fields='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer EAAG_valid_test_token',
        }),
      }),
    );
  });

  it('throws ValidationError with sanitized message on 401 Unauthorized from Meta', async () => {
    const secretToken = 'EAAG_super_secret_token_12345';
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: `Invalid OAuth access token ${secretToken}`,
          type: 'OAuthException',
          code: 190,
        },
      }),
    });

    const promise = validateMetaCredentials({
      phoneNumberId: '106540352242922',
      accessToken: secretToken,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(promise).rejects.toThrow(ValidationError);
    await expect(promise).rejects.toThrow('Meta credential verification failed (401)');
    // Assert token was redacted from error message
    await expect(promise).rejects.not.toThrow(secretToken);
  });

  it('handles network failure during verification', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Connection timeout'));

    const promise = validateMetaCredentials({
      phoneNumberId: '106540352242922',
      accessToken: 'sample_token',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(promise).rejects.toThrow(ValidationError);
    await expect(promise).rejects.toThrow('Failed to connect to Meta WhatsApp API');
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
