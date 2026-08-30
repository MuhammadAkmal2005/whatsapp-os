import { describe, expect, it } from 'vitest';
import {
  checkLimit,
  getPlan,
  ORDERED_PLANS,
  PLAN_KEYS,
  planHasFeature,
  PLANS,
} from '@/config/plans';
import { resolveEffectivePlanKey } from '@/server/repositories/subscription.repository';

describe('Plan Limits, Entitlements & Effective Plan Resolution Unit Tests', () => {
  it('1. returns all defined plans and respects plan hierarchy order', () => {
    expect(PLAN_KEYS).toEqual(['free', 'starter', 'business', 'pro']);
    expect(ORDERED_PLANS.length).toBe(4);
    expect(ORDERED_PLANS[0]?.key).toBe('free');
    expect(ORDERED_PLANS[3]?.key).toBe('pro');
  });

  it('2. getPlan returns requested plan or safely fails closed to free plan', () => {
    expect(getPlan('starter').name).toBe('Starter');
    expect(getPlan('business').name).toBe('Business');
    expect(getPlan('pro').name).toBe('Pro');
    // Unknown or deprecated plan fails closed to free
    expect(getPlan('enterprise_unknown').key).toBe('free');
  });

  it('3. checks feature entitlements accurately for each tier', () => {
    expect(planHasFeature('free', 'ai_agent')).toBe(true);
    expect(planHasFeature('free', 'advanced_analytics')).toBe(false);
    expect(planHasFeature('free', 'multiple_numbers')).toBe(false);

    expect(planHasFeature('starter', 'analytics')).toBe(true);
    expect(planHasFeature('starter', 'multiple_numbers')).toBe(false);

    expect(planHasFeature('business', 'multiple_numbers')).toBe(true);
    expect(planHasFeature('business', 'advanced_analytics')).toBe(true);
    expect(planHasFeature('business', 'audit_log_export')).toBe(false);

    expect(planHasFeature('pro', 'audit_log_export')).toBe(true);
    expect(planHasFeature('pro', 'api_access')).toBe(true);
  });

  it('4. evaluates checkLimit for unmetered (null) limits', () => {
    // Pro plan has unmetered contacts and products
    const contactsCheck = checkLimit('pro', 'contacts', 1_000_000, 500);
    expect(contactsCheck.allowed).toBe(true);
    expect(contactsCheck.limit).toBeNull();
    expect(contactsCheck.remaining).toBeNull();
    expect(contactsCheck.ratio).toBe(0);
    expect(contactsCheck.nearLimit).toBe(false);
  });

  it('5. evaluates checkLimit for numeric limits (under, near, and exceeded)', () => {
    // Free plan has 20 products
    const under = checkLimit('free', 'products', 10, 1);
    expect(under.allowed).toBe(true);
    expect(under.limit).toBe(20);
    expect(under.used).toBe(10);
    expect(under.remaining).toBe(10);
    expect(under.ratio).toBe(0.5);
    expect(under.nearLimit).toBe(false);

    // 16 used out of 20 = 80% (near limit warning)
    const near = checkLimit('free', 'products', 16, 1);
    expect(near.allowed).toBe(true);
    expect(near.ratio).toBe(0.8);
    expect(near.nearLimit).toBe(true);

    // 20 used out of 20, requesting 1 -> disallowed
    const exceeded = checkLimit('free', 'products', 20, 1);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.remaining).toBe(0);
    expect(exceeded.ratio).toBe(1);
    expect(exceeded.nearLimit).toBe(true);
  });

  it('6. resolves effective plan key with trial expiration and cancellation lifecycle', () => {
    const now = new Date('2026-08-31T12:00:00Z');

    // 1. Missing subscription defaults to free
    expect(resolveEffectivePlanKey(null, now)).toBe('free');

    // 2. Active trial in the future resolves to trial plan (e.g. business)
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'business',
          status: 'TRIAL',
          trialEndsAt: new Date('2026-09-14T12:00:00Z'),
          currentPeriodEnd: new Date('2026-09-14T12:00:00Z'),
        },
        now,
      ),
    ).toBe('business');

    // 3. Expired trial drops gracefully to free plan
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'business',
          status: 'TRIAL',
          trialEndsAt: new Date('2026-08-30T12:00:00Z'), // Past
          currentPeriodEnd: new Date('2026-08-30T12:00:00Z'),
        },
        now,
      ),
    ).toBe('free');

    // 4. Active paid subscription resolves to subscribed plan
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'starter',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-30T12:00:00Z'),
        },
        now,
      ),
    ).toBe('starter');

    // 5. Canceled subscription before period end remains active on plan
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'starter',
          status: 'ACTIVE',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date('2026-09-30T12:00:00Z'), // Future
        },
        now,
      ),
    ).toBe('starter');

    // 6. Canceled subscription past period end drops to free
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'starter',
          status: 'ACTIVE',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date('2026-08-30T12:00:00Z'), // Past
        },
        now,
      ),
    ).toBe('free');

    // 7. Explicit EXPIRED status drops to free
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'pro',
          status: 'EXPIRED',
          currentPeriodEnd: new Date('2026-08-30T12:00:00Z'),
        },
        now,
      ),
    ).toBe('free');
  });
});
