/**
 * How a customer's status and lead stage look.
 *
 * Kept in one module because the same two vocabularies appear on the list, the
 * profile, the filter chips and eventually the inbox, and a colour that means
 * "at risk" in one place and "fine" in another is worse than no colour at all.
 *
 * No `'use client'` — these are pure functions over a string, so they render on
 * the server and cost the browser nothing.
 */

import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  CONTACT_STATUS_LABELS,
  LEAD_STAGE_LABELS,
  type ContactStatus,
  type LeadStage,
} from '@/server/validation/contact';

/**
 * Status is about the commercial relationship, so the colour tracks value to the
 * business: a paying customer is positive, a lead is neutral-but-live, a lapsed
 * one is quiet, and blocked is a warning because it changes how the AI behaves.
 */
const STATUS_VARIANT: Record<ContactStatus, BadgeProps['variant']> = {
  LEAD: 'default',
  NEW: 'default',
  ACTIVE: 'success',
  RETURNING: 'success',
  VIP: 'warning',
  INACTIVE: 'muted',
  BLOCKED: 'danger',
};

/**
 * Stage is about movement through the pipeline, so only the two ends are coloured.
 * Colouring every step would make a list of leads look like a fault report.
 */
const STAGE_VARIANT: Record<LeadStage, BadgeProps['variant']> = {
  NEW: 'outline',
  CONTACTED: 'outline',
  QUALIFIED: 'outline',
  INTERESTED: 'outline',
  NEGOTIATION: 'outline',
  CONVERTED: 'success',
  LOST: 'muted',
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{CONTACT_STATUS_LABELS[status]}</Badge>;
}

export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  return <Badge variant={STAGE_VARIANT[stage]}>{LEAD_STAGE_LABELS[stage]}</Badge>;
}

/**
 * What to call a customer who has not told us their name.
 *
 * WhatsApp supplies a profile name on the first inbound message, which is usually
 * a real name and is better than the number. Falling all the way back to the
 * number is honest: it is what the business has.
 */
export function displayName(contact: {
  name: string | null;
  waProfileName: string | null;
  phoneE164: string;
}): string {
  return contact.name ?? contact.waProfileName ?? contact.phoneE164;
}
