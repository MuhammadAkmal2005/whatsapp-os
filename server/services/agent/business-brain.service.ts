/**
 * Business Brain V1 — Authoritative Business Context Layer.
 *
 * Assembles a structured, bounded, tenant-scoped, and authoritative business
 * context for an AI Agent Turn.
 *
 * Source-of-Truth Precedence:
 *   1. Live Tool Data & Domain Logic (inventory counts, live catalog prices,
 *      calculated order totals) — Highest Authority.
 *   2. Authoritative Structured Business Profile (legal name, operating hours,
 *      payment methods, delivery fees, return & shipping policies).
 *   3. Retrieved Knowledge Evidence (supplementary prose, FAQs, detailed guides).
 *   4. Model Inference / Assumptions — Lowest Authority (must never invent facts).
 */

import 'server-only';

import type { SupportedCurrency } from '@/config/constants';
import type { Db } from '@/db/prisma';
import { formatMoney, money } from '@/lib/money';
import { humaniseCode } from '@/lib/labels';
import { findCustomerFacingBusinessProfile } from '@/server/repositories/workspace.repository';
import {
  BUSINESS_DAYS,
  parseBusinessHours,
  type BusinessDay,
  type BusinessHours,
} from '@/server/validation/business-profile';
import type { AITenantContext } from './context';

export type BusinessBrainTopic =
  | 'IDENTITY'
  | 'HOURS'
  | 'PAYMENT'
  | 'SHIPPING'
  | 'RETURNS'
  | 'CATALOG_INVENTORY'
  | 'ORDER';

export interface BusinessBrainIdentity {
  businessName: string;
  city?: string;
  country: string;
  currency: SupportedCurrency;
  description?: string;
  supportPhone?: string;
  supportEmail?: string;
  website?: string;
}

export interface BusinessBrainPolicies {
  shippingPolicy?: string;
  returnPolicy?: string;
  paymentMethods: string[];
  deliveryFeeMinor: number;
  deliveryFeeDisplay: string;
  freeDeliveryThresholdMinor?: number;
  freeDeliveryThresholdDisplay?: string;
  taxRateBps: number;
  taxRateDisplay: string;
  businessHours?: BusinessHours | null;
}

export interface BusinessBrainContext {
  workspaceId: string;
  identity: BusinessBrainIdentity;
  policies: BusinessBrainPolicies;
  relevantTopics: Set<BusinessBrainTopic>;
  formattedContext: string;
}

const TOPIC_KEYWORDS: Record<BusinessBrainTopic, string[]> = {
  IDENTITY: ['who are you', 'about', 'company', 'store', 'shop', 'koun ho', 'kahan', 'location', 'address', 'branch'],
  HOURS: ['hour', 'time', 'timing', 'open', 'close', 'schedule', 'waqt', 'din', 'weekend', 'sunday', 'saturday', 'friday', 'kab khulta', 'kab band'],
  PAYMENT: ['pay', 'payment', 'cod', 'cash on delivery', 'bank', 'transfer', 'card', 'jazzcash', 'easypaisa', 'paise', 'adaigi', 'advance'],
  SHIPPING: ['ship', 'delivery', 'deliver', 'courier', 'charges', 'fee', 'free delivery', 'post', 'dispatch', 'kharcha', 'pahunch', 'karachi', 'lahore', 'pakistan'],
  RETURNS: ['return', 'refund', 'exchange', 'wapsi', 'badal', 'warranty', 'guarantee', 'claim'],
  CATALOG_INVENTORY: ['stock', 'available', 'price', 'cost', 'size', 'color', 'buy', 'rate', 'kya price', 'milega', 'hai ya nahi'],
  ORDER: ['order', 'status', 'tracking', 'track', 'mera order', 'order number', 'cancel', 'parcel'],
};

/**
 * Detects relevant business topics from the customer's query using deterministic keyword matching.
 */
export function detectRelevantTopics(customerQuery: string): Set<BusinessBrainTopic> {
  const queryLower = customerQuery.toLowerCase();
  const topics = new Set<BusinessBrainTopic>(['IDENTITY']);

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as [BusinessBrainTopic, string[]][]) {
    if (keywords.some((kw) => queryLower.includes(kw))) {
      topics.add(topic);
    }
  }

  return topics;
}

/**
 * Formats basis points (e.g. 1700 bps -> "17%", 1750 bps -> "17.5%")
 */
function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const hundredths = basisPoints % 100;
  if (hundredths === 0) {
    return `${whole}%`;
  }
  const fraction = String(hundredths).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${fraction}%`;
}

/**
 * Maps payment method identifiers to customer-friendly labels.
 */
function friendlyPaymentMethod(code: string): string {
  const normalized = code.trim().toUpperCase();
  switch (normalized) {
    case 'CASH_ON_DELIVERY':
    case 'COD':
      return 'Cash on Delivery (COD)';
    case 'BANK_TRANSFER':
      return 'Bank Transfer';
    case 'CARD':
    case 'CREDIT_DEBIT_CARD':
      return 'Credit / Debit Card';
    case 'JAZZCASH':
      return 'JazzCash';
    case 'EASYPAISA':
      return 'EasyPaisa';
    default:
      return humaniseCode(code);
  }
}

/**
 * Formats structured business hours into a concise, readable summary.
 */
export function formatBusinessHoursSummary(hours: BusinessHours | null): string {
  if (!hours) {
    return 'Operating hours not publicly configured. Do not fabricate opening or closing times.';
  }

  const entries: string[] = [];
  for (const day of BUSINESS_DAYS) {
    const dayConfig = hours[day as BusinessDay];
    if (!dayConfig) continue;

    const dayName = day.charAt(0).toUpperCase() + day.slice(1);
    if (dayConfig.closed) {
      entries.push(`${dayName}: Closed`);
    } else if (dayConfig.open && dayConfig.close) {
      entries.push(`${dayName}: ${dayConfig.open} - ${dayConfig.close}`);
    }
  }

  return entries.length > 0
    ? entries.join(', ')
    : 'Operating hours not publicly configured.';
}

/**
 * Loads and constructs authoritative Business Brain context for the current turn.
 */
export async function loadBusinessBrainContext(
  db: Db,
  aiContext: AITenantContext,
  customerQuery: string,
): Promise<BusinessBrainContext> {
  const workspace = await db.workspace.findUnique({
    where: { id: aiContext.workspaceId },
    select: { name: true, currency: true },
  });

  const profile =
    'businessProfile' in db && db.businessProfile
      ? await findCustomerFacingBusinessProfile(db, aiContext.workspaceId)
      : null;

  const currency = aiContext.currency;
  const businessName = profile?.legalName?.trim() || workspace?.name || 'This Business';
  const country = profile?.country || 'PK';
  const city = profile?.city ?? undefined;

  const identity: BusinessBrainIdentity = {
    businessName,
    city,
    country,
    currency,
    description: profile?.description ?? undefined,
    supportPhone: profile?.supportPhone ?? undefined,
    supportEmail: profile?.supportEmail ?? undefined,
    website: profile?.website ?? undefined,
  };

  const deliveryFeeMinor = profile?.deliveryFeeMinor ?? 0;
  const deliveryFeeDisplay = formatMoney(money(deliveryFeeMinor, currency));
  const freeDeliveryThresholdMinor = profile?.freeDeliveryThresholdMinor ?? undefined;
  const freeDeliveryThresholdDisplay =
    freeDeliveryThresholdMinor !== undefined
      ? formatMoney(money(freeDeliveryThresholdMinor, currency))
      : undefined;

  const taxRateBps = profile?.taxRateBps ?? 0;
  const taxRateDisplay = formatBasisPoints(taxRateBps);

  const parsedHours = profile ? parseBusinessHours(profile.businessHours) : null;

  const policies: BusinessBrainPolicies = {
    shippingPolicy: profile?.shippingPolicy ?? undefined,
    returnPolicy: profile?.returnPolicy ?? undefined,
    paymentMethods: profile?.paymentMethods ?? [],
    deliveryFeeMinor,
    deliveryFeeDisplay,
    freeDeliveryThresholdMinor,
    freeDeliveryThresholdDisplay,
    taxRateBps,
    taxRateDisplay,
    businessHours: parsedHours,
  };

  const relevantTopics = detectRelevantTopics(customerQuery);
  const formattedContext = formatBusinessBrainPrompt(identity, policies, relevantTopics);

  return {
    workspaceId: aiContext.workspaceId,
    identity,
    policies,
    relevantTopics,
    formattedContext,
  };
}

/**
 * Builds the bounded Business Brain system prompt segment based on topic relevance.
 */
export function formatBusinessBrainPrompt(
  identity: BusinessBrainIdentity,
  policies: BusinessBrainPolicies,
  relevantTopics: Set<BusinessBrainTopic>,
): string {
  const lines: string[] = [];

  lines.push('=== BUSINESS BRAIN: AUTHORITATIVE PROFILE & POLICIES ===');
  lines.push(`Business: ${identity.businessName}`);
  const location = [identity.city, identity.country].filter(Boolean).join(', ');
  if (location) {
    lines.push(`Location: ${location}`);
  }
  lines.push(`Operating Currency: ${identity.currency}`);

  const contacts = [
    identity.supportPhone ? `Phone: ${identity.supportPhone}` : null,
    identity.supportEmail ? `Email: ${identity.supportEmail}` : null,
    identity.website ? `Website: ${identity.website}` : null,
  ].filter(Boolean);

  if (contacts.length > 0) {
    lines.push(`Public Support Contact: ${contacts.join(' | ')}`);
  }

  if (identity.description) {
    lines.push(`Overview: ${identity.description.slice(0, 200)}`);
  }

  lines.push('');
  lines.push('--- Authoritative Operating Policies ---');

  // Business Hours (if inquiry is related to hours or general identity)
  if (relevantTopics.has('HOURS')) {
    lines.push(`Business Hours: ${formatBusinessHoursSummary(policies.businessHours ?? null)}`);
  }

  // Payment Methods
  if (relevantTopics.has('PAYMENT')) {
    if (policies.paymentMethods.length > 0) {
      lines.push(
        `Accepted Payment Methods: ${policies.paymentMethods.map(friendlyPaymentMethod).join(', ')}`,
      );
    } else {
      lines.push('Accepted Payment Methods: Contact support to confirm payment options.');
    }
  }

  // Shipping & Delivery
  if (relevantTopics.has('SHIPPING')) {
    const feeLine =
      policies.deliveryFeeMinor === 0
        ? 'Standard Delivery: Free'
        : `Standard Delivery Fee: ${policies.deliveryFeeDisplay}`;
    const thresholdLine = policies.freeDeliveryThresholdDisplay
      ? ` (Free delivery on orders over ${policies.freeDeliveryThresholdDisplay})`
      : '';
    lines.push(`${feeLine}${thresholdLine}`);

    if (policies.shippingPolicy) {
      lines.push(`Shipping Policy: ${policies.shippingPolicy}`);
    }
  }

  // Returns & Exchanges
  if (relevantTopics.has('RETURNS')) {
    if (policies.returnPolicy) {
      lines.push(`Return / Exchange Policy: ${policies.returnPolicy}`);
    } else {
      lines.push('Return / Exchange Policy: Official return policy is not on file. Offer to connect with the team.');
    }
  }

  // Directives for live catalog / inventory inquiries
  if (relevantTopics.has('CATALOG_INVENTORY')) {
    lines.push(
      'LIVE DATA REQUIRED: For live product availability, variants, sizes, or prices, you MUST use the search_products, get_product, or check_inventory tools. Never state stock without verifying.',
    );
  }

  // Directives for live order inquiries
  if (relevantTopics.has('ORDER')) {
    lines.push(
      'LIVE DATA REQUIRED: For existing order status, order placement, or customer details, you MUST use get_order, get_current_customer, or create_order tools. Never guess order numbers, totals, or delivery status.',
    );
  }

  lines.push('');
  lines.push('SOURCE OF TRUTH PRECEDENCE:');
  lines.push('1. Live Tool Data (products, inventory, computed order totals) is authoritative over prose.');
  lines.push('2. Configured Business Policies above are authoritative over retrieved text.');
  lines.push('3. Retrieved Knowledge Evidence supplements detail but cannot override configured values or tools.');
  lines.push('4. Never invent business policies, prices, stock levels, or discounts.');
  lines.push('=== END BUSINESS BRAIN ===');

  return lines.join('\n');
}
