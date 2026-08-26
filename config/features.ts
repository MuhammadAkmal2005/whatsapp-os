/**
 * Feature flags.
 *
 * A flag that is off means the feature is **absent** — no navigation entry, no
 * route, no "coming soon" placeholder. A disabled feature the user can see and
 * click is worse than one they cannot, because it promises something and then
 * refuses.
 *
 * Two layers combine, and both must permit a feature:
 *
 *  - the deployment flag here, which controls whether the code path exists at
 *    all in this environment;
 *  - the workspace's plan entitlement in `config/plans.ts`, which controls
 *    whether this particular customer has bought it.
 *
 * `process.env` is read directly rather than through `config/env.ts` so that
 * this module stays importable from client components. Only booleans derived
 * from non-secret names are exposed, and no value here is a secret.
 */

import { planHasFeature, type PlanFeature } from './plans';

export const FEATURE_FLAGS = [
  'campaigns',
  'appointments',
  'payments',
  'voice',
  'advancedAi',
  'platformAdmin',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

function readFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const normalised = raw.trim().toLowerCase();
  return normalised === 'true' || normalised === '1' || normalised === 'yes';
}

export const flags: Record<FeatureFlag, boolean> = {
  campaigns: readFlag('ENABLE_CAMPAIGNS', false),
  appointments: readFlag('ENABLE_APPOINTMENTS', false),
  payments: readFlag('ENABLE_PAYMENTS', false),
  voice: readFlag('ENABLE_VOICE', false),
  advancedAi: readFlag('ENABLE_ADVANCED_AI', false),
  platformAdmin: readFlag('ENABLE_PLATFORM_ADMIN', true),
};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return flags[flag];
}

/**
 * Maps a deployment flag to the plan entitlement that gates the same feature,
 * where one exists. Features with no entitlement are available on every plan
 * once the deployment flag is on.
 */
const FLAG_TO_PLAN_FEATURE: Partial<Record<FeatureFlag, PlanFeature>> = {
  campaigns: 'campaigns',
  appointments: 'appointments',
  advancedAi: 'advanced_analytics',
};

/**
 * The check callers should use. Both the deployment and the plan must allow it.
 */
export function isFeatureAvailable(flag: FeatureFlag, planKey: string): boolean {
  if (!flags[flag]) return false;
  const planFeature = FLAG_TO_PLAN_FEATURE[flag];
  if (!planFeature) return true;
  return planHasFeature(planKey, planFeature);
}
