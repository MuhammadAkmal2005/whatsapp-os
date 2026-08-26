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
 * This module is **server-only**, and the reason is a bug it used to have. It
 * read `process.env.ENABLE_CAMPAIGNS` directly so that it could be imported
 * from a client component. Next.js only inlines `NEXT_PUBLIC_*` names into the
 * client bundle, so on the client every one of those reads was `undefined` and
 * every flag silently fell back to its default. `platformAdmin` defaults to
 * *true*, which means the failure ran in the dangerous direction: a deployment
 * that had switched the platform admin surface off would still have rendered it
 * client-side. A flag that fails closed is a bug; a flag that fails open is an
 * incident.
 *
 * Renaming the variables to `NEXT_PUBLIC_*` would have made the reads work and
 * kept two other problems. `NEXT_PUBLIC_` values are inlined at build time, so
 * one build could no longer serve two deployments with different flags, and the
 * whole flag set would ship in a bundle any visitor can read. Flags are
 * deployment configuration, not public data.
 *
 * So flags resolve on the server and travel to the client as props. A server
 * component calls `resolveFeatures` and passes the plain object down. See
 * `ResolvedFeatures` below.
 *
 * Values come from `config/env.ts`, which already parses and validates all six
 * names with these same defaults. This module used to re-parse them with its own
 * reader, which is the "same rule written twice" that `CLAUDE.md` warns about —
 * and the two copies had already drifted: the local reader treated an
 * unrecognised value like `ENABLE_CAMPAIGNS=ture` as `false`, silently disabling
 * a feature someone believed they had enabled, where the Zod schema refuses to
 * boot and names the variable.
 */

import 'server-only';

import { env } from './env';
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

export const flags: Record<FeatureFlag, boolean> = {
  campaigns: env.ENABLE_CAMPAIGNS,
  appointments: env.ENABLE_APPOINTMENTS,
  payments: env.ENABLE_PAYMENTS,
  voice: env.ENABLE_VOICE,
  advancedAi: env.ENABLE_ADVANCED_AI,
  platformAdmin: env.ENABLE_PLATFORM_ADMIN,
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

/**
 * A flag set already reduced against a workspace's plan, safe to serialise
 * across the server/client boundary as props.
 *
 * Deliberately a plain `Record` of booleans rather than a richer object: it has
 * to survive React's serialisation, and a client component has no business
 * knowing *why* a feature is unavailable. Deployment flag off and plan does not
 * include it are the same fact to the UI — do not render it.
 */
export type ResolvedFeatures = Record<FeatureFlag, boolean>;

/**
 * Resolve every flag for one workspace's plan. Call this in a server component
 * or layout and pass the result to client components as a prop.
 */
export function resolveFeatures(planKey: string): ResolvedFeatures {
  const resolved = {} as ResolvedFeatures;
  for (const flag of FEATURE_FLAGS) {
    resolved[flag] = isFeatureAvailable(flag, planKey);
  }
  return resolved;
}
