import { describe, expect, it } from 'vitest';

import {
  FEATURE_FLAGS,
  flags,
  isFeatureAvailable,
  isFeatureEnabled,
  resolveFeatures,
  type FeatureFlag,
} from '@/config/features';

/**
 * These tests lock in the two-gate rule and the shape of the object that crosses
 * the server/client boundary.
 *
 * They are written against the defaults, because `flags` is resolved once at
 * import time from `config/env.ts` and there is deliberately no setter — a flag
 * that can be changed at runtime is not a deployment flag. Mutating
 * `process.env` inside a test would not move it either, which is the point.
 *
 * With no `ENABLE_*` set, the defaults are: everything off except
 * `platformAdmin`. That combination is useful rather than incidental — it gives
 * one flag on and five off in the same run.
 */
describe('feature flags', () => {
  it('resolves from the validated environment with documented defaults', () => {
    expect(flags.campaigns).toBe(false);
    expect(flags.appointments).toBe(false);
    expect(flags.payments).toBe(false);
    expect(flags.voice).toBe(false);
    expect(flags.advancedAi).toBe(false);
    expect(flags.platformAdmin).toBe(true);
  });

  it('exposes a boolean for every declared flag and nothing else', () => {
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_FLAGS].sort());
    for (const value of Object.values(flags)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('reads the same value through isFeatureEnabled', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(isFeatureEnabled(flag)).toBe(flags[flag]);
    }
  });

  describe('the deployment flag is the outer gate', () => {
    // The regression that matters. `business` includes campaigns, appointments
    // and advanced_analytics as plan entitlements, so if the plan check were
    // consulted first — or instead — these would come back available on a
    // deployment where the code path is switched off.
    it('refuses a feature the plan includes when the deployment flag is off', () => {
      expect(isFeatureAvailable('campaigns', 'business')).toBe(false);
      expect(isFeatureAvailable('appointments', 'business')).toBe(false);
      expect(isFeatureAvailable('advancedAi', 'business')).toBe(false);
    });

    it('refuses a feature with no plan entitlement when the flag is off', () => {
      expect(isFeatureAvailable('payments', 'pro')).toBe(false);
      expect(isFeatureAvailable('voice', 'pro')).toBe(false);
    });

    it('allows a flag that is on and has no plan entitlement, on the lowest plan', () => {
      expect(isFeatureAvailable('platformAdmin', 'free')).toBe(true);
    });
  });

  describe('unknown plan keys fail closed', () => {
    // `getPlan` falls back to `free` rather than throwing, so a subscription
    // pointing at a withdrawn plan degrades instead of erroring. Confirm that
    // fallback does not accidentally grant an entitlement.
    it('treats an unrecognised plan as free', () => {
      expect(isFeatureAvailable('campaigns', 'enterprise-2019')).toBe(
        isFeatureAvailable('campaigns', 'free'),
      );
      expect(isFeatureAvailable('platformAdmin', 'nonsense')).toBe(true);
    });
  });

  describe('resolveFeatures', () => {
    it('returns exactly one entry per flag', () => {
      const resolved = resolveFeatures('business');
      expect(Object.keys(resolved).sort()).toEqual([...FEATURE_FLAGS].sort());
    });

    it('agrees with isFeatureAvailable for every flag', () => {
      for (const planKey of ['free', 'starter', 'business', 'pro']) {
        const resolved = resolveFeatures(planKey);
        for (const flag of FEATURE_FLAGS) {
          expect(resolved[flag]).toBe(isFeatureAvailable(flag, planKey));
        }
      }
    });

    it('survives serialisation, because it crosses the server/client boundary as props', () => {
      const resolved = resolveFeatures('business');
      // A value React cannot serialise would fail at the boundary rather than
      // here, in a stack trace that names the component instead of this module.
      expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
    });

    it('does not leak why a feature is unavailable', () => {
      const resolved = resolveFeatures('free');
      for (const value of Object.values(resolved)) {
        expect(typeof value).toBe('boolean');
      }
    });

    it('returns a fresh object each call, so a caller cannot mutate shared state', () => {
      const first = resolveFeatures('business');
      const second = resolveFeatures('business');
      expect(first).not.toBe(second);

      (first as Record<FeatureFlag, boolean>).platformAdmin = false;
      expect(second.platformAdmin).toBe(true);
      expect(flags.platformAdmin).toBe(true);
    });
  });
});
