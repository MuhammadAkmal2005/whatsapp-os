/**
 * Business Rules / Policy Intelligence V1 — Deterministic Rule Evaluation Layer.
 *
 * Enforces authoritative, deterministic business rules across:
 *   1. Payment methods (configured vs unconfigured, memory conflict resolution)
 *   2. Returns / exchanges (return windows, condition checks, structured precedence)
 *   3. Shipping / delivery (standard fees, free delivery thresholds, geography)
 *   4. Business hours (real-time open/closed evaluation, preventing false human claims)
 *   5. Discounts / promotions (strict denial when unconfigured, no autonomous discounts)
 *   6. Order modifications (no autonomous mutations, human handoff boundaries)
 *   7. Human escalation / approval triggers
 *
 * Source-of-Truth Precedence Hierarchy:
 *   Level 1: Live Tool Data & Domain Logic (inventory counts, live product prices, calculated totals)
 *   Level 2: Structured Business Rules & BusinessProfile (payment methods, return policy, delivery fees, hours)
 *   Level 3: Knowledge Base / RAG Evidence (supplementary detail; cannot override Level 1 or 2)
 *   Level 4: Customer Memory (historical customer context only; grants NO commercial authority)
 *   Level 5: Model Inference (lowest authority; must NEVER invent rules or commercial terms)
 */

import 'server-only';

import { type HandoffReason } from '@prisma/client';
import {
  BUSINESS_DAYS,
  type BusinessDay,
  type BusinessHours,
  type DayHours,
} from '@/server/validation/business-profile';
import { humaniseCode } from '@/lib/labels';
import type {
  BusinessBrainIdentity,
  BusinessBrainPolicies,
} from './business-brain.service';

export type BusinessRuleCategory =
  | 'PAYMENT'
  | 'RETURNS'
  | 'SHIPPING'
  | 'HOURS'
  | 'DISCOUNT'
  | 'ORDER_MODIFICATION'
  | 'CATALOG_INVENTORY'
  | 'ORDER'
  | 'GENERAL';

export type BusinessRuleOutcome =
  | 'ALLOWED'
  | 'NOT_ALLOWED'
  | 'NEEDS_INFORMATION'
  | 'NEEDS_HUMAN'
  | 'NOT_APPLICABLE';

export interface BusinessRuleEvaluation {
  category: BusinessRuleCategory;
  outcome: BusinessRuleOutcome;
  reason: string;
  directive: string;
  isDeterministic: boolean;
  sourceLevel: 1 | 2 | 3 | 4 | 5;
  requiresHumanHandoff?: boolean;
  handoffReason?: HandoffReason;
}

export interface BusinessRulesEvaluationResult {
  evaluations: BusinessRuleEvaluation[];
  requiresHandoff: boolean;
  handoffReason?: HandoffReason;
  formattedDirectives: string;
}

export interface CustomerMemorySnapshot {
  category: string;
  key: string;
  value: string;
}

export interface EvaluateBusinessRulesInput {
  workspaceId: string;
  customerQuery: string;
  policies: BusinessBrainPolicies;
  identity: BusinessBrainIdentity;
  customerMemories?: readonly CustomerMemorySnapshot[];
  currentTime?: Date;
  timeZone?: string;
}

/**
 * Extracts return window days from structured return policy text.
 * E.g. "14-day return policy" -> 14, "Returns within 30 days" -> 30, "7 din wapsi" -> 7
 */
export function extractReturnWindowDays(returnPolicy?: string | null): number | null {
  if (!returnPolicy) return null;
  const match = returnPolicy.match(/\b(\d+)\s*(?:-| )?(?:days?|din)\b/i);
  if (match && match[1]) {
    const days = parseInt(match[1], 10);
    return isNaN(days) ? null : days;
  }
  return null;
}

/**
 * Extracts return window days requested in the customer query.
 * E.g. "10 din baad return kar sakta hoon?" -> 10, "Can I return after 20 days?" -> 20
 */
export function extractRequestedReturnDays(query: string): number | null {
  const match = query.match(/\b(\d+)\s*(?:-| )?(?:days?|din)\b/i);
  if (match && match[1]) {
    const days = parseInt(match[1], 10);
    return isNaN(days) ? null : days;
  }
  return null;
}

/**
 * Normalizes payment method string for matching against configured methods.
 */
export function normalizePaymentMethodCode(code: string): string {
  const clean = code.trim().toUpperCase().replace(/[\s_-]+/g, '_');
  if (clean === 'COD' || clean === 'CASH_ON_DELIVERY' || clean === 'CASH') {
    return 'CASH_ON_DELIVERY';
  }
  if (clean === 'BANK' || clean === 'BANK_TRANSFER' || clean === 'TRANSFER' || clean === 'IBFT') {
    return 'BANK_TRANSFER';
  }
  if (clean === 'CARD' || clean === 'CREDIT_CARD' || clean === 'DEBIT_CARD' || clean === 'CREDIT_DEBIT_CARD') {
    return 'CARD';
  }
  if (clean === 'JAZZCASH') {
    return 'JAZZCASH';
  }
  if (clean === 'EASYPAISA') {
    return 'EASYPAISA';
  }
  return clean;
}

/**
 * Checks if a requested payment method is accepted by the business.
 */
export function isPaymentMethodSupported(requestedMethod: string, configuredMethods: readonly string[]): boolean {
  const normalizedRequested = normalizePaymentMethodCode(requestedMethod);
  return configuredMethods.some(
    (configured) => normalizePaymentMethodCode(configured) === normalizedRequested,
  );
}

/**
 * Customer-friendly formatting for payment methods.
 */
export function formatFriendlyPaymentMethods(methods: readonly string[]): string {
  if (methods.length === 0) {
    return 'None configured on file';
  }
  return methods
    .map((m) => {
      const norm = normalizePaymentMethodCode(m);
      switch (norm) {
        case 'CASH_ON_DELIVERY':
          return 'Cash on Delivery (COD)';
        case 'BANK_TRANSFER':
          return 'Bank Transfer';
        case 'CARD':
          return 'Credit/Debit Card';
        case 'JAZZCASH':
          return 'JazzCash';
        case 'EASYPAISA':
          return 'EasyPaisa';
        default:
          return humaniseCode(m);
      }
    })
    .join(', ');
}

export interface BusinessHoursCheckResult {
  isOpen: boolean;
  currentDay: BusinessDay | '';
  currentTime: string;
  dayConfig?: DayHours | null;
  reason: string;
}

/**
 * Deterministically checks if the current time falls within configured business hours.
 */
export function isWithinBusinessHours(
  businessHours: BusinessHours | null,
  now: Date = new Date(),
  timeZone: string = 'Asia/Karachi',
): BusinessHoursCheckResult {
  if (!businessHours) {
    return {
      isOpen: false,
      currentDay: '',
      currentTime: '',
      reason: 'Operating hours are not configured on file.',
    };
  }

  let weekday: BusinessDay;
  let currentTime: string;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const dayStr = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
    weekday = (BUSINESS_DAYS.includes(dayStr as BusinessDay) ? dayStr : 'monday') as BusinessDay;

    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
    currentTime = `${hourStr.padStart(2, '0')}:${minStr.padStart(2, '0')}`;
  } catch {
    // Fallback if timezone string is unrecognized
    const dayIndex = now.getDay(); // 0 is Sun, 1 is Mon
    const dayMap: BusinessDay[] = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    weekday = dayMap[dayIndex] ?? 'monday';
    currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  const dayConfig = businessHours[weekday];
  if (!dayConfig || dayConfig.closed) {
    return {
      isOpen: false,
      currentDay: weekday,
      currentTime,
      dayConfig,
      reason: `Business is closed today (${weekday.charAt(0).toUpperCase() + weekday.slice(1)}).`,
    };
  }

  if (dayConfig.open && dayConfig.close) {
    const isOpen = currentTime >= dayConfig.open && currentTime < dayConfig.close;
    return {
      isOpen,
      currentDay: weekday,
      currentTime,
      dayConfig,
      reason: isOpen
        ? `Business is currently OPEN (${dayConfig.open} - ${dayConfig.close}).`
        : `Currently outside operating hours (open ${dayConfig.open} - ${dayConfig.close}, current time ${currentTime}).`,
    };
  }

  return {
    isOpen: false,
    currentDay: weekday,
    currentTime,
    dayConfig,
    reason: 'Operating hours for today are unspecified.',
  };
}

/**
 * Evaluates business rules deterministically against customer input and business configuration.
 */
export function evaluateBusinessRules(input: EvaluateBusinessRulesInput): BusinessRulesEvaluationResult {
  const { customerQuery, policies, customerMemories, currentTime = new Date(), timeZone = 'Asia/Karachi' } = input;
  const queryLower = customerQuery.toLowerCase();
  const evaluations: BusinessRuleEvaluation[] = [];

  let requiresHandoff = false;
  let handoffReason: HandoffReason | undefined;

  // -------------------------------------------------------------------------
  // 1. PAYMENT METHOD RULES
  // -------------------------------------------------------------------------
  const isPaymentInquiry =
    /\b(pay|payment|cod|cash\s*on\s*delivery|bank\s*transfer|jazzcash|easypaisa|card|naqad|adaigi)\b/i.test(
      queryLower,
    );

  if (isPaymentInquiry) {
    const mentionsCod = /\b(cod|cash\s*on\s*delivery|naqad)\b/i.test(queryLower);
    const mentionsBank = /\b(bank\s*transfer|bank|wire|ibft)\b/i.test(queryLower);
    const mentionsCard = /\b(card|credit|debit|visa|mastercard)\b/i.test(queryLower);
    const mentionsJazzCash = /\bjazzcash\b/i.test(queryLower);
    const mentionsEasyPaisa = /\beasypaisa\b/i.test(queryLower);

    const configuredMethods = policies.paymentMethods;
    const friendlyConfigured = formatFriendlyPaymentMethods(configuredMethods);

    // Check customer memory for payment preference
    const memoryCodPref = customerMemories?.some(
      (m) => m.category === 'PREFERENCE' && m.key === 'preferred_payment_method' && /cod/i.test(m.value),
    );

    if (mentionsCod) {
      const isCodSupported = isPaymentMethodSupported('CASH_ON_DELIVERY', configuredMethods);
      if (isCodSupported) {
        evaluations.push({
          category: 'PAYMENT',
          outcome: 'ALLOWED',
          reason: 'Cash on Delivery (COD) is enabled in business configuration.',
          directive: 'Cash on Delivery (COD) is supported. You may confirm COD is available.',
          isDeterministic: true,
          sourceLevel: 2,
        });
      } else {
        // Even if memory says preferred COD, Level 2 Business Rules override Level 4 Memory
        evaluations.push({
          category: 'PAYMENT',
          outcome: 'NOT_ALLOWED',
          reason: memoryCodPref
            ? 'Cash on Delivery (COD) is disabled in business profile (overriding customer memory preference).'
            : 'Cash on Delivery (COD) is not accepted by this business.',
          directive: `Cash on Delivery (COD) is NOT accepted by this business. You must NOT promise or accept COD under any circumstances. Accepted payment methods: ${friendlyConfigured}.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      }
    } else if (mentionsBank || mentionsCard || mentionsJazzCash || mentionsEasyPaisa) {
      const requestedMethod = mentionsBank
        ? 'BANK_TRANSFER'
        : mentionsCard
          ? 'CARD'
          : mentionsJazzCash
            ? 'JAZZCASH'
            : 'EASYPAISA';

      const isSupported = isPaymentMethodSupported(requestedMethod, configuredMethods);
      if (isSupported) {
        evaluations.push({
          category: 'PAYMENT',
          outcome: 'ALLOWED',
          reason: `Payment method ${requestedMethod} is enabled in business configuration.`,
          directive: `${formatFriendlyPaymentMethods([requestedMethod])} is supported. You may confirm it is accepted.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      } else {
        evaluations.push({
          category: 'PAYMENT',
          outcome: 'NOT_ALLOWED',
          reason: `Payment method ${requestedMethod} is not enabled in business profile.`,
          directive: `The requested payment method is NOT supported. Allowed payment methods are: ${friendlyConfigured}.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      }
    } else {
      // General payment inquiry
      evaluations.push({
        category: 'PAYMENT',
        outcome: 'ALLOWED',
        reason: 'General payment inquiry handled from structured profile.',
        directive: `State accepted payment methods: ${friendlyConfigured}.`,
        isDeterministic: true,
        sourceLevel: 2,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. RETURN & EXCHANGE RULES
  // -------------------------------------------------------------------------
  const isReturnInquiry =
    /\b(return|refund|exchange|wapsi|badal|warranty|guarantee)\b/i.test(queryLower);

  if (isReturnInquiry) {
    const configuredDays = extractReturnWindowDays(policies.returnPolicy);
    const requestedDays = extractRequestedReturnDays(queryLower);

    if (configuredDays !== null && requestedDays !== null) {
      if (requestedDays <= configuredDays) {
        evaluations.push({
          category: 'RETURNS',
          outcome: 'ALLOWED',
          reason: `Return requested for ${requestedDays} days is within the configured ${configuredDays}-day return window.`,
          directive: `Returns within ${configuredDays} days are permitted under store policy (customer asked about ${requestedDays} days). Confirm that this timeframe is acceptable, provided items remain in original condition/tags.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      } else {
        evaluations.push({
          category: 'RETURNS',
          outcome: 'NOT_ALLOWED',
          reason: `Return requested for ${requestedDays} days exceeds the configured ${configuredDays}-day return window.`,
          directive: `Return after ${requestedDays} days EXCEEDS the official ${configuredDays}-day return window. State politely that returns past ${configuredDays} days cannot be accepted under store policy.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      }
    } else if (policies.returnPolicy) {
      evaluations.push({
        category: 'RETURNS',
        outcome: 'ALLOWED',
        reason: 'Authoritative return policy is configured in business profile.',
        directive: `Authoritative Return Policy: "${policies.returnPolicy}". This structured rule strictly overrides any conflicting knowledge document text.`,
        isDeterministic: true,
        sourceLevel: 2,
      });
    } else {
      // Return policy missing from profile
      const isDemandingRefund = /\b(refund\s*kar\s*do|give\s*me\s*refund|i\s*want\s*refund|money\s*back)\b/i.test(
        queryLower,
      );
      if (isDemandingRefund) {
        requiresHandoff = true;
        handoffReason = 'REFUND_REQUEST';
        evaluations.push({
          category: 'RETURNS',
          outcome: 'NEEDS_HUMAN',
          reason: 'No structured return/refund policy configured and customer is demanding a refund.',
          directive:
            'No official return or refund policy is on file. Do NOT invent refund terms or guarantee money back. Connect customer with human support.',
          isDeterministic: true,
          sourceLevel: 2,
          requiresHumanHandoff: true,
          handoffReason: 'REFUND_REQUEST',
        });
      } else {
        evaluations.push({
          category: 'RETURNS',
          outcome: 'NEEDS_INFORMATION',
          reason: 'Return policy is not structured on file.',
          directive:
            'Official return policy is not on file. Do NOT invent a return window. Check retrieved knowledge evidence if present, or offer to connect with the team.',
          isDeterministic: false,
          sourceLevel: 3,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. SHIPPING & DELIVERY RULES
  // -------------------------------------------------------------------------
  const isShippingInquiry =
    /\b(ship|shipping|delivery|deliver|courier|charges|delivery\s*fee|free\s*delivery|dispatch)\b/i.test(
      queryLower,
    );

  if (isShippingInquiry) {
    const feeDisplay =
      policies.deliveryFeeMinor === 0 ? 'Free' : policies.deliveryFeeDisplay;
    const thresholdDisplay = policies.freeDeliveryThresholdDisplay;

    const asksAboutFreeDelivery = /\b(?:free\s*delivery|delivery\s*free|muft\s*delivery)\b/i.test(queryLower);

    if (asksAboutFreeDelivery && policies.deliveryFeeMinor > 0) {
      if (thresholdDisplay) {
        evaluations.push({
          category: 'SHIPPING',
          outcome: 'ALLOWED',
          reason: `Free delivery requires meeting threshold (${thresholdDisplay}).`,
          directive: `Free delivery is available ONLY on orders above ${thresholdDisplay}. For orders below, standard delivery fee of ${feeDisplay} applies.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      } else {
        evaluations.push({
          category: 'SHIPPING',
          outcome: 'NOT_ALLOWED',
          reason: 'No free delivery threshold configured; standard delivery fee applies.',
          directive: `Free delivery is not offered. Standard delivery fee is ${feeDisplay}.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      }
    } else {
      evaluations.push({
        category: 'SHIPPING',
        outcome: 'ALLOWED',
        reason: 'Standard shipping configuration on file.',
        directive: `Standard delivery fee is ${feeDisplay}.${
          thresholdDisplay ? ` Free delivery on orders over ${thresholdDisplay}.` : ''
        } ${policies.shippingPolicy ? `Policy: "${policies.shippingPolicy}".` : ''} Do NOT invent unconfigured geographic restrictions.`,
        isDeterministic: true,
        sourceLevel: 2,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. BUSINESS HOURS RULES
  // -------------------------------------------------------------------------
  const isHoursInquiry =
    /\b(hour|time|timing|open|close|schedule|waqt|online|help\s*right\s*now|available\s*now|someone\s*help|right\s*now|human)\b/i.test(
      queryLower,
    );

  if (isHoursInquiry) {
    const hoursCheck = isWithinBusinessHours(policies.businessHours ?? null, currentTime, timeZone);
    const asksIfLiveHumanAvailable =
      /\b(help\s*(?:me\s*)?right\s*now|someone\s*(?:can\s*)?help|talk\s*to\s*(?:human|agent|person)|live\s*person)\b/i.test(
        queryLower,
      );

    if (!policies.businessHours) {
      evaluations.push({
        category: 'HOURS',
        outcome: 'NEEDS_INFORMATION',
        reason: 'Business hours are not publicly configured.',
        directive:
          'Operating hours are not configured on file. Do NOT fabricate opening or closing times, and do NOT claim live human staff is standing by.',
        isDeterministic: true,
        sourceLevel: 2,
      });
    } else if (hoursCheck.isOpen) {
      evaluations.push({
        category: 'HOURS',
        outcome: 'ALLOWED',
        reason: `Current time (${hoursCheck.currentTime}) is within operating hours for ${hoursCheck.currentDay}.`,
        directive: `Business is currently OPEN. Inform customer of store hours. Never guarantee immediate human agent response time unless verified.`,
        isDeterministic: true,
        sourceLevel: 2,
      });
    } else {
      // Business is closed
      if (asksIfLiveHumanAvailable) {
        requiresHandoff = true;
        handoffReason = 'OUTSIDE_BUSINESS_HOURS';
        evaluations.push({
          category: 'HOURS',
          outcome: 'NOT_ALLOWED',
          reason: `Customer requested live help outside business hours (${hoursCheck.reason}).`,
          directive: `Business is currently CLOSED (${hoursCheck.reason}). State store hours clearly. Do NOT claim live human staff is available right now.`,
          isDeterministic: true,
          sourceLevel: 2,
          requiresHumanHandoff: true,
          handoffReason: 'OUTSIDE_BUSINESS_HOURS',
        });
      } else {
        evaluations.push({
          category: 'HOURS',
          outcome: 'NOT_ALLOWED',
          reason: `Business is closed right now (${hoursCheck.reason}).`,
          directive: `Business is currently CLOSED (${hoursCheck.reason}). State store hours clearly. Do NOT invent alternate hours.`,
          isDeterministic: true,
          sourceLevel: 2,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. DISCOUNT & PROMOTIONAL AUTHORITY RULES
  // -------------------------------------------------------------------------
  const isDiscountInquiry =
    /\b(discount|off|coupon|promo|voucher|concession|kam\s*(?:karo|kar|karein)|kitna\s*kam|sasta)\b/i.test(
      queryLower,
    );

  if (isDiscountInquiry) {
    // Check if customer memory has discount assertion (e.g. VIP discount)
    const memoryDiscount = customerMemories?.find(
      (m) => m.category === 'CUSTOMER_CONTEXT' && /discount|vip/i.test(m.key + ' ' + m.value),
    );

    evaluations.push({
      category: 'DISCOUNT',
      outcome: 'NOT_ALLOWED',
      reason: memoryDiscount
        ? `No authoritative discount rule configured (Customer Memory assertion "${memoryDiscount.value}" grants NO authority).`
        : 'No authoritative discount or promotional rule is configured for the AI agent.',
      directive:
        'You have NO authority to promise, calculate, or agree to custom discounts, coupon codes, or percentage markdowns. Prices and totals are strictly determined by catalog tools and order totals. Politely state that prices are as listed. Offer connection to human team only if customer insists.',
      isDeterministic: true,
      sourceLevel: 2,
    });
  }

  // -------------------------------------------------------------------------
  // 6. ORDER MODIFICATION & CANCELLATION RULES
  // -------------------------------------------------------------------------
  const isOrderMutationInquiry =
    /\b(cancel\s*(?:my\s*)?order|order\s*cancel|change\s*(?:my\s*)?order|modify\s*(?:my\s*)?order|order\s*badal|order\s*change|item\s*remove|address\s*change)\b/i.test(
      queryLower,
    );

  if (isOrderMutationInquiry) {
    const isCancellation = /\bcancel\b/i.test(queryLower);
    requiresHandoff = true;
    handoffReason = 'CUSTOMER_REQUESTED';

    evaluations.push({
      category: 'ORDER_MODIFICATION',
      outcome: 'NEEDS_HUMAN',
      reason: isCancellation
        ? 'AI agent lacks tools and authority to cancel confirmed orders autonomously.'
        : 'AI agent lacks tools and authority to modify confirmed orders autonomously.',
      directive:
        'You do NOT have autonomous authority or tools to cancel or modify confirmed orders. You must NEVER tell the customer their order was changed or cancelled. Politely explain that order adjustments require human team verification, and hand off the conversation.',
      isDeterministic: true,
      sourceLevel: 1, // Domain permission boundary
      requiresHumanHandoff: true,
      handoffReason: 'CUSTOMER_REQUESTED',
    });
  }

  // -------------------------------------------------------------------------
  // 7. CATALOG & INVENTORY INQUIRIES (Level 1 Mandate)
  // -------------------------------------------------------------------------
  const isCatalogInquiry =
    /\b(stock|available|price|cost|size|color|hai\s*ya\s*nahi|milega|rates?|suit|shirt|kurta|fabric)\b/i.test(
      queryLower,
    );

  if (isCatalogInquiry) {
    evaluations.push({
      category: 'CATALOG_INVENTORY',
      outcome: 'ALLOWED',
      reason:
        'Catalog stock and price inquiries require live tool execution (search_products, check_inventory, get_product).',
      directive:
        'LIVE DATA MANDATE: For product stock, sizing, variants, or prices, you MUST use the search_products, check_inventory, or get_product tools. Never state availability from memory or static knowledge.',
      isDeterministic: true,
      sourceLevel: 1,
    });
  }

  // -------------------------------------------------------------------------
  // 8. ORDER STATUS & TRACKING INQUIRIES (Level 1 Mandate)
  // -------------------------------------------------------------------------
  const isOrderLookup =
    !isOrderMutationInquiry &&
    /\b(order|status|track|tracking|parcel|dispatch\s*status)\b/i.test(queryLower);

  if (isOrderLookup) {
    evaluations.push({
      category: 'ORDER',
      outcome: 'ALLOWED',
      reason: 'Order status lookups require live tool execution (get_order).',
      directive:
        'LIVE DATA MANDATE: For order status, parcel tracking, or details, you MUST use the get_order tool. Never guess tracking or delivery status.',
      isDeterministic: true,
      sourceLevel: 1,
    });
  }

  // -------------------------------------------------------------------------
  // Format Directives Block
  // -------------------------------------------------------------------------
  const directiveLines: string[] = [];
  if (evaluations.length > 0) {
    directiveLines.push('=== DETERMINISTIC BUSINESS RULES (AUTHORITATIVE) ===');
    for (const ev of evaluations) {
      directiveLines.push(`[RULE: ${ev.category} -> ${ev.outcome}]`);
      directiveLines.push(`Directive: ${ev.directive}`);
    }
    directiveLines.push('');
    directiveLines.push('SOURCE-OF-TRUTH PRECEDENCE:');
    directiveLines.push('1. Live Tools (inventory, calculated totals, order status) — Highest Authority.');
    directiveLines.push('2. Deterministic Business Rules above — Strictly authoritative over knowledge prose.');
    directiveLines.push('3. Knowledge Evidence — Supporting documentation only; cannot override rules or tools.');
    directiveLines.push('4. Customer Memory — Historical context only; grants NO commercial authority or discounts.');
    directiveLines.push('5. Model Inference — Lowest authority; must NEVER invent rules or promise discounts.');
    directiveLines.push('=== END BUSINESS RULES ===');
  }

  return {
    evaluations,
    requiresHandoff,
    handoffReason,
    formattedDirectives: directiveLines.join('\n'),
  };
}
