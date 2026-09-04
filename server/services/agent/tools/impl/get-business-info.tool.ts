/**
 * `get_business_info` — the business's own facts, from the business's own record.
 *
 * Before this tool the agent had no retrieval path for "delivery kitna hai?", "return
 * policy kya hai?" or "kya aap COD lete ho?". Under the grounding rule it therefore had
 * to say it did not know and hand off — for questions the shop owner had already
 * answered in their settings. This is what makes those answers speakable.
 *
 * Two deliberate constraints:
 *
 *   1. The data is read through a repository whose `select` names only customer-facing
 *      columns, so the private ones — the street address, the logo key, the privacy
 *      policy, the surrogate ids — are never loaded into this process at all. That is
 *      stronger than filtering here: a later refactor that spreads the row cannot leak
 *      what was never fetched.
 *   2. Money is returned as integer minor units *and* a pre-formatted string. The string
 *      exists so the model quotes "Rs. 250" verbatim rather than dividing 25000 by 100
 *      itself and having a chance of saying "Rs. 25,000" to a customer.
 *
 * Hours are exposed but not enforced. Whether the agent should stop answering outside
 * opening hours is a product decision with its own failure mode — a customer messaging
 * at 11pm and getting silence — and it is not this tool's to make.
 */

import 'server-only';

import { z } from 'zod';

import { prisma } from '@/db/prisma';
import { formatMoney, money } from '@/lib/money';
import { findCustomerFacingBusinessProfile } from '@/server/repositories/workspace.repository';
import {
  BUSINESS_DAYS,
  type BusinessDay,
  parseBusinessHours,
} from '@/server/validation/business-profile';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';

export interface BusinessDayHoursDTO {
  day: BusinessDay;
  /** Absent when the business recorded the day as closed without times. */
  open?: string;
  close?: string;
  closed: boolean;
}

export interface BusinessInfoResultDTO {
  legalName?: string;
  description?: string;
  city?: string;
  country: string;
  supportPhone?: string;
  supportEmail?: string;
  website?: string;
  currency: string;
  deliveryFeeMinor: number;
  deliveryFeeDisplay: string;
  /** Absent means no threshold is configured — not a threshold of zero. */
  freeDeliveryThresholdMinor?: number;
  freeDeliveryThresholdDisplay?: string;
  taxRateBps: number;
  taxRateDisplay: string;
  paymentMethods: string[];
  shippingPolicy?: string;
  returnPolicy?: string;
  /** Only the days the business actually filled in, in week order. */
  businessHours?: BusinessDayHoursDTO[];
}

/**
 * Renders a basis-point rate as a percentage the model can repeat verbatim.
 *
 * Built from integer arithmetic rather than `bps / 100` so the string is exact: 1750
 * reads as "17.5%", 1705 as "17.05%", 1700 as "17%" with no trailing noise.
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

export const getBusinessInfoTool: AITool<
  Record<string, never>,
  BusinessInfoResultDTO | { error: string; message: string }
> = {
  name: 'get_business_info',
  description:
    "Retrieve the business's own published details — delivery fee and free-delivery " +
    'threshold, tax rate, accepted payment methods, shipping and return policies, ' +
    'opening hours, support contacts and location. Use this to answer any question ' +
    'about how the business operates instead of guessing.',
  inputSchema: z
    .object({})
    .describe('No arguments required; resolves the business from the current workspace'),
  classification: 'READ',
  capabilityRequired: 'business:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext) => {
    const profile = await findCustomerFacingBusinessProfile(prisma, ctx.workspaceId);

    // No profile row means the owner has configured nothing, and the column defaults
    // would read as "delivery is free, no tax" — a fabrication dressed as data. An
    // explicit miss is what makes the agent say it does not know and hand off.
    if (!profile) {
      return {
        error: 'NOT_CONFIGURED',
        message:
          'This business has not filled in its details yet. Do not guess delivery ' +
          'charges, policies or opening hours; tell the customer you will check and ' +
          'hand the conversation to a person.',
      };
    }

    const currency = ctx.currency;
    const hours = parseBusinessHours(profile.businessHours);
    const threshold = profile.freeDeliveryThresholdMinor;

    return {
      legalName: profile.legalName ?? undefined,
      description: profile.description ?? undefined,
      city: profile.city ?? undefined,
      country: profile.country,
      supportPhone: profile.supportPhone ?? undefined,
      supportEmail: profile.supportEmail ?? undefined,
      website: profile.website ?? undefined,
      currency,
      deliveryFeeMinor: profile.deliveryFeeMinor,
      deliveryFeeDisplay: formatMoney(money(profile.deliveryFeeMinor, currency)),
      freeDeliveryThresholdMinor: threshold ?? undefined,
      freeDeliveryThresholdDisplay:
        threshold === null ? undefined : formatMoney(money(threshold, currency)),
      taxRateBps: profile.taxRateBps,
      taxRateDisplay: formatBasisPoints(profile.taxRateBps),
      paymentMethods: profile.paymentMethods,
      shippingPolicy: profile.shippingPolicy ?? undefined,
      returnPolicy: profile.returnPolicy ?? undefined,
      businessHours: hours
        ? BUSINESS_DAYS.flatMap((day) => {
            const entry = hours[day];
            return entry === undefined
              ? []
              : [{ day, open: entry.open, close: entry.close, closed: entry.closed }];
          })
        : undefined,
    };
  },
};
