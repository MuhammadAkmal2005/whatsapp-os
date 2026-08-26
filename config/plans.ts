/**
 * Plan catalogue. This file is the source of truth for pricing, limits and
 * entitlements; nothing else in the codebase may hard-code a price or a numeric
 * limit. A seed step mirrors these rows into the `plans` table so that a
 * subscription can reference a plan by key and historical plans survive a
 * pricing change.
 *
 * Dependency-free on purpose — limit arithmetic is unit-tested directly.
 */

import { DEFAULT_CURRENCY, type SupportedCurrency } from './constants';

export const PLAN_KEYS = ['free', 'starter', 'business', 'pro'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/**
 * Every limit is a whole number, or `null` meaning unmetered. `null` is
 * deliberately distinct from a very large number: "unlimited" should read as
 * unlimited in the UI rather than as "999999".
 */
export type PlanLimits = {
  /** Connected WhatsApp numbers. */
  whatsappNumbers: number | null;
  teamMembers: number | null;
  contacts: number | null;
  products: number | null;
  /** AI turns per calendar month. The main cost driver. */
  aiRequestsPerMonth: number | null;
  /** Outbound WhatsApp messages per calendar month. */
  messagesPerMonth: number | null;
  knowledgeDocuments: number | null;
  storageMegabytes: number | null;
  automations: number | null;
  campaignsPerMonth: number | null;
};

export type PlanFeature =
  | 'ai_agent'
  | 'knowledge_base'
  | 'human_handoff'
  | 'automations'
  | 'analytics'
  | 'advanced_analytics'
  | 'multiple_numbers'
  | 'campaigns'
  | 'appointments'
  | 'api_access'
  | 'priority_support'
  | 'audit_log_export';

export type Plan = {
  key: PlanKey;
  name: string;
  /** Written for a shop owner, not a procurement department. */
  tagline: string;
  priceMinor: number;
  currency: SupportedCurrency;
  interval: 'month' | 'year';
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeature[];
  isPublic: boolean;
  position: number;
  /** Rendered with a highlight on the pricing page. Exactly one should be true. */
  highlighted?: boolean;
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: 'free',
    name: 'Free',
    tagline: 'Try it on one number and see what your AI can do.',
    priceMinor: 0,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    trialDays: 0,
    limits: {
      whatsappNumbers: 1,
      teamMembers: 1,
      contacts: 100,
      products: 20,
      aiRequestsPerMonth: 100,
      messagesPerMonth: 300,
      knowledgeDocuments: 5,
      storageMegabytes: 50,
      automations: 1,
      campaignsPerMonth: 0,
    },
    features: ['ai_agent', 'knowledge_base', 'human_handoff'],
    isPublic: true,
    position: 0,
  },

  starter: {
    key: 'starter',
    name: 'Starter',
    tagline: 'For a growing shop handling orders every day.',
    priceMinor: 249_900, // Rs. 2,499
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    trialDays: 14,
    limits: {
      whatsappNumbers: 1,
      teamMembers: 3,
      contacts: 2_000,
      products: 200,
      aiRequestsPerMonth: 2_000,
      messagesPerMonth: 5_000,
      knowledgeDocuments: 25,
      storageMegabytes: 500,
      automations: 5,
      campaignsPerMonth: 2,
    },
    features: [
      'ai_agent',
      'knowledge_base',
      'human_handoff',
      'automations',
      'analytics',
    ],
    isPublic: true,
    position: 1,
  },

  business: {
    key: 'business',
    name: 'Business',
    tagline: 'A full team, deeper automation and proper reporting.',
    priceMinor: 699_900, // Rs. 6,999
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    trialDays: 14,
    limits: {
      whatsappNumbers: 2,
      teamMembers: 10,
      contacts: 15_000,
      products: 2_000,
      aiRequestsPerMonth: 12_000,
      messagesPerMonth: 30_000,
      knowledgeDocuments: 150,
      storageMegabytes: 5_000,
      automations: 25,
      campaignsPerMonth: 10,
    },
    features: [
      'ai_agent',
      'knowledge_base',
      'human_handoff',
      'automations',
      'analytics',
      'advanced_analytics',
      'multiple_numbers',
      'campaigns',
      'appointments',
    ],
    isPublic: true,
    position: 2,
    highlighted: true,
  },

  pro: {
    key: 'pro',
    name: 'Pro',
    tagline: 'Multiple numbers, unmetered AI and priority support.',
    priceMinor: 1_499_900, // Rs. 14,999
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    trialDays: 14,
    limits: {
      whatsappNumbers: 10,
      teamMembers: null,
      contacts: null,
      products: null,
      aiRequestsPerMonth: null,
      messagesPerMonth: null,
      knowledgeDocuments: null,
      storageMegabytes: 50_000,
      automations: null,
      campaignsPerMonth: null,
    },
    features: [
      'ai_agent',
      'knowledge_base',
      'human_handoff',
      'automations',
      'analytics',
      'advanced_analytics',
      'multiple_numbers',
      'campaigns',
      'appointments',
      'api_access',
      'priority_support',
      'audit_log_export',
    ],
    isPublic: true,
    position: 3,
  },
};

export const ORDERED_PLANS: Plan[] = Object.values(PLANS).sort(
  (a, b) => a.position - b.position,
);

/**
 * New workspaces open on a trial of this plan, so the owner sees the full
 * product while onboarding rather than a stripped-down free tier. When the trial
 * ends (Phase 8 billing), a workspace that has not paid drops to `free`. Chosen
 * here rather than in a service so the trial policy sits beside the plans it
 * refers to.
 */
export const DEFAULT_TRIAL_PLAN_KEY: PlanKey = 'business';

export function getPlan(key: string): Plan {
  const plan = PLANS[key as PlanKey];
  if (!plan) {
    // A subscription pointing at a plan we no longer publish would otherwise
    // fail open and grant unlimited use. Falling back to `free` fails closed.
    return PLANS.free;
  }
  return plan;
}

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export function planHasFeature(planKey: string, feature: PlanFeature): boolean {
  return getPlan(planKey).features.includes(feature);
}

export type LimitName = keyof PlanLimits;

export type LimitCheck = {
  /** False when the action must be refused. */
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  /** Fraction of the limit consumed, 0–1. Always 0 for unmetered limits. */
  ratio: number;
  /** True from 80% consumed, so the UI can warn before anything breaks. */
  nearLimit: boolean;
};

/**
 * The single place a limit is evaluated. `requested` is how many units the
 * pending action would consume — a bulk import asks for many at once, and
 * checking one at a time would let it slip past the ceiling.
 */
export function checkLimit(
  planKey: string,
  limitName: LimitName,
  used: number,
  requested = 1,
): LimitCheck {
  const limit = getPlan(planKey).limits[limitName];

  if (limit === null) {
    return { allowed: true, limit: null, used, remaining: null, ratio: 0, nearLimit: false };
  }

  const remaining = Math.max(0, limit - used);
  const ratio = limit === 0 ? 1 : Math.min(1, used / limit);

  return {
    allowed: used + requested <= limit,
    limit,
    used,
    remaining,
    ratio,
    nearLimit: ratio >= 0.8,
  };
}

export const NEAR_LIMIT_WARNING_RATIO = 0.8;
