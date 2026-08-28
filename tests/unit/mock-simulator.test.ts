import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const mockInboundSchema = z.object({
  fromPhone: z.string().min(1, 'Phone number is required'),
  body: z.string().min(1, 'Message body is required').max(4096),
  waProfileName: z.string().max(128).optional().nullable(),
  providerMessageId: z.string().optional(),
});

const mockStatusSchema = z.object({
  providerMessageId: z.string().min(1, 'Provider message ID is required'),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  errorCode: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
});

describe('Mock Simulator Validation Unit Tests', () => {
  it('validates valid simulated inbound message inputs', () => {
    const parsed = mockInboundSchema.safeParse({
      fromPhone: '+923001234567',
      body: 'Is this embroidered kurta available?',
      waProfileName: 'Zainab Bibi',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.fromPhone).toBe('+923001234567');
      expect(parsed.data.body).toBe('Is this embroidered kurta available?');
      expect(parsed.data.waProfileName).toBe('Zainab Bibi');
    }
  });

  it('rejects empty phone or empty body in inbound simulation', () => {
    const emptyPhone = mockInboundSchema.safeParse({
      fromPhone: '',
      body: 'Hello',
    });
    expect(emptyPhone.success).toBe(false);

    const emptyBody = mockInboundSchema.safeParse({
      fromPhone: '+923001234567',
      body: '',
    });
    expect(emptyBody.success).toBe(false);
  });

  it('validates simulated status receipt inputs correctly', () => {
    const validDelivered = mockStatusSchema.safeParse({
      providerMessageId: 'wamid.mock_12345',
      status: 'DELIVERED',
    });
    expect(validDelivered.success).toBe(true);

    const validRead = mockStatusSchema.safeParse({
      providerMessageId: 'wamid.mock_12345',
      status: 'READ',
    });
    expect(validRead.success).toBe(true);

    const validFailed = mockStatusSchema.safeParse({
      providerMessageId: 'wamid.mock_12345',
      status: 'FAILED',
      errorCode: 'DELIVERY_TIMEOUT',
      errorMessage: 'Handset offline',
    });
    expect(validFailed.success).toBe(true);
  });

  it('rejects invalid status types in status receipt simulation', () => {
    const invalid = mockStatusSchema.safeParse({
      providerMessageId: 'wamid.mock_12345',
      status: 'SEEN_CUSTOM',
    });
    expect(invalid.success).toBe(false);
  });
});
