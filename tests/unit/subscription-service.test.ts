import { describe, expect, it } from 'vitest';
import { changePlanSchema } from '@/server/validation/subscription';

describe('Subscription Validation & Service Unit Tests', () => {
  it('1. validates changePlanSchema for valid plan keys', () => {
    expect(changePlanSchema.safeParse({ planKey: 'free' }).success).toBe(true);
    expect(changePlanSchema.safeParse({ planKey: 'starter' }).success).toBe(true);
    expect(changePlanSchema.safeParse({ planKey: 'business' }).success).toBe(true);
    expect(changePlanSchema.safeParse({ planKey: 'pro' }).success).toBe(true);
  });

  it('2. rejects invalid plan keys in changePlanSchema', () => {
    const invalid = changePlanSchema.safeParse({ planKey: 'unlimited_enterprise' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]?.message).toBe('Please select a valid plan.');
    }

    expect(changePlanSchema.safeParse({}).success).toBe(false);
    expect(changePlanSchema.safeParse({ planKey: 123 }).success).toBe(false);
  });
});
