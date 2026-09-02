/**
 * Human labels for the product's machine codes.
 *
 * One home for the mapping, because a code like `LOW_CONFIDENCE` will otherwise be
 * translated into English by every screen that shows it, and the wording will drift until
 * the inbox and the analytics page appear to be describing two different systems.
 *
 * The register is a shop owner's, not a developer's: "The AI wasn't sure enough", not "Low
 * confidence". Where the underlying column is a free-text string rather than a closed set —
 * and so can hold a code this file has never seen — `humaniseCode` degrades gracefully
 * instead of printing `SCREAMING_SNAKE_CASE` at someone.
 *
 * Tables are keyed off the validation constants rather than off Prisma's generated enums, so
 * that adding a reason without adding its label is a type error, and so that nothing in the
 * client bundle has to know the database exists. This is the beginning of the localisation
 * structure, not a replacement for it: when Urdu is added, these tables are what gets
 * translated.
 */

import type { LimitName, PlanFeature } from '@/config/plans';
import type { ActionType, RunStatus, TriggerType } from '@/server/validation/automation';
import type { HANDOFF_REASONS } from '@/server/validation/conversation';

type HandoffReason = (typeof HANDOFF_REASONS)[number];

/** Why a conversation left the AI and went to a person. */
export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  CUSTOMER_REQUESTED: 'Customer asked for a person',
  LOW_CONFIDENCE: "The AI wasn't sure enough",
  UNKNOWN_QUESTION: "The AI didn't know the answer",
  REFUND_REQUEST: 'Refund requested',
  COMPLAINT: 'Complaint',
  NEGATIVE_SENTIMENT: 'Customer sounded unhappy',
  HIGH_VALUE_CUSTOMER: 'High-value customer',
  SENSITIVE_TOPIC: 'Sensitive topic',
  PAYMENT_ISSUE: 'Payment problem',
  AI_ERROR: 'The AI hit an error',
  OUTSIDE_BUSINESS_HOURS: 'Outside your business hours',
  MANUAL_TAKEOVER: 'Someone on your team took over',
};

/** Where an AI reply was generated: a real conversation, a test, or an automation. */
export const TURN_SOURCE_LABELS: Record<string, string> = {
  CONVERSATION: 'Customer conversations',
  PLAYGROUND: 'Your own tests',
  AUTOMATION: 'Automations',
};

/**
 * Turns an unrecognised machine code into something readable — `UNSUPPORTED_DISCOUNT_CLAIM`
 * becomes "Unsupported discount claim".
 *
 * For columns typed as free text, where a new code can appear in the database without this
 * file changing. Prefer a table above whenever the set is closed.
 */
export function humaniseCode(code: string): string {
  const words = code.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Looks a handoff reason up in the table, falling back to the humanised code. */
export function handoffReasonLabel(reason: string): string {
  return HANDOFF_REASON_LABELS[reason as HandoffReason] ?? humaniseCode(reason);
}

/** Looks a turn source up in the table, falling back to the humanised code. */
export function turnSourceLabel(source: string): string {
  return TURN_SOURCE_LABELS[source] ?? humaniseCode(source);
}

/* ------------------------------------------------------------------------- */
/* Automations                                                               */
/* ------------------------------------------------------------------------- */

/**
 * What starts an automation.
 *
 * Written as the event, not as the column that records it, and always in a form that reads
 * correctly after the word "When" — because that is the only place it ever appears, whether
 * as the option in the builder's picker or as the value in the list's "When" column.
 *
 * The list previously carried its own copy of this table covering ten of the thirteen
 * triggers, so an automation started by a new customer, an incoming payment or an upcoming
 * appointment showed `CONTACT_CREATED` to the shop owner. Keying the record off the
 * validation type means the next trigger added cannot repeat that.
 */
export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  MESSAGE_RECEIVED: 'any message arrives',
  MESSAGE_CONTAINS: 'a message mentions a word',
  CONVERSATION_OPENED: 'a chat is opened',
  CONVERSATION_IDLE: 'a chat goes quiet',
  CONVERSATION_RESOLVED: 'a chat is marked resolved',
  CONTACT_CREATED: 'a new customer is added',
  LEAD_STAGE_CHANGED: 'a lead moves stage',
  ORDER_CREATED: 'an order is placed',
  ORDER_STATUS_CHANGED: 'an order changes status',
  PAYMENT_RECEIVED: 'a payment comes in',
  APPOINTMENT_UPCOMING: 'an appointment is coming up',
  HANDOFF_REQUESTED: 'a chat is handed to your team',
  LOW_STOCK: 'a product runs low',
};

/**
 * What an automation does, phrased as an instruction.
 *
 * These read in sequence — "Send a message → Wait → Add a tag" — so the imperative is what
 * makes a pipeline of three of them scannable at a glance.
 */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  SEND_MESSAGE: 'Send a message',
  SEND_TEMPLATE: 'Send a template',
  WAIT: 'Wait',
  ADD_TAG: 'Add a tag',
  REMOVE_TAG: 'Remove a tag',
  ASSIGN_CONVERSATION: 'Assign the chat',
  SET_CONVERSATION_STATUS: 'Change the chat status',
  SET_PRIORITY: 'Change the priority',
  SET_LEAD_STAGE: 'Move the lead stage',
  PAUSE_AI: 'Pause the AI',
  RESUME_AI: 'Resume the AI',
  NOTIFY_TEAM: 'Notify your team',
  CREATE_NOTE: 'Add a note',
};

/** How one execution of an automation ended, or has not ended yet. */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  RUNNING: 'Running',
  WAITING: 'Waiting',
  COMPLETED: 'Finished',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/**
 * Looks a trigger up in the table, falling back to the humanised code.
 *
 * The lookup takes a plain string because the automation rows reach the UI as data loaded
 * from the database rather than as a narrowed union, and a screen must not fail to render
 * because a row holds a value this build has not heard of.
 */
export function triggerTypeLabel(triggerType: string): string {
  return TRIGGER_TYPE_LABELS[triggerType as TriggerType] ?? humaniseCode(triggerType);
}

/** Looks an action up in the table, falling back to the humanised code. */
export function actionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType as ActionType] ?? humaniseCode(actionType);
}

/** Looks a run status up in the table, falling back to the humanised code. */
export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as RunStatus] ?? humaniseCode(status);
}

/* ------------------------------------------------------------------------- */
/* Plan limits                                                               */
/* ------------------------------------------------------------------------- */

/**
 * What each plan allowance is called on screen.
 *
 * The billing screen and the analytics usage panel show the same ten allowances, and each
 * had its own wording — "AI Requests (mo)" against "Monthly AI Requests" for one number.
 * A shop owner does not send "requests"; the AI sends replies.
 */
export const LIMIT_LABELS: Record<LimitName, string> = {
  whatsappNumbers: 'WhatsApp numbers',
  teamMembers: 'Team members',
  contacts: 'Customers',
  products: 'Products',
  aiRequestsPerMonth: 'AI replies',
  messagesPerMonth: 'Messages sent',
  knowledgeDocuments: 'Knowledge files',
  storageMegabytes: 'File storage',
  automations: 'Automations',
  campaignsPerMonth: 'Broadcasts',
};

/**
 * Allowances that empty at the start of each month, in the order they are shown.
 *
 * Kept apart from capacity below because "4,800 of 5,000 used" means something quite
 * different when the counter resets on the first — one is a warning, the other is a wall.
 */
export const MONTHLY_LIMIT_NAMES: readonly LimitName[] = [
  'aiRequestsPerMonth',
  'messagesPerMonth',
  'campaignsPerMonth',
];

/** What the workspace holds right now. These only go down when something is deleted. */
export const CAPACITY_LIMIT_NAMES: readonly LimitName[] = [
  'whatsappNumbers',
  'teamMembers',
  'contacts',
  'products',
  'knowledgeDocuments',
  'automations',
  'storageMegabytes',
];

/**
 * The few allowances worth putting on a plan card, in the order a shop owner asks about them.
 *
 * Ten rows on a card nobody reads is worse than five they do. The full set lives on the billing
 * screen, where someone has gone looking for it.
 */
export const HEADLINE_LIMIT_NAMES: readonly LimitName[] = [
  'aiRequestsPerMonth',
  'whatsappNumbers',
  'teamMembers',
  'contacts',
  'automations',
];

export function limitLabel(name: LimitName): string {
  return LIMIT_LABELS[name] ?? humaniseCode(name);
}

/**
 * The label with its period attached, for places that show one allowance out of context.
 *
 * A plan card lists "AI replies" and "Customers" side by side, and only one of them refills each
 * month. Without the qualifier the reader has to already know which is which.
 */
export function limitLabelWithPeriod(name: LimitName): string {
  const label = limitLabel(name);
  return MONTHLY_LIMIT_NAMES.includes(name) ? `${label} / month` : label;
}

/**
 * Formats an allowance's count in the unit its reader thinks in.
 *
 * Only storage differs: it is recorded in megabytes, and a 5 GB allowance printed as "5,120"
 * makes the reader do arithmetic to find out whether they are near it.
 */
export function formatLimitValue(name: LimitName, value: number): string {
  if (name !== 'storageMegabytes') return value.toLocaleString();

  if (value >= 1024) {
    return `${(value / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  }

  return `${value.toLocaleString()} MB`;
}

/** An allowance as shown on a plan card, where `null` means the plan does not meter it. */
export function formatLimitAllowance(name: LimitName, value: number | null): string {
  return value === null ? 'Unlimited' : formatLimitValue(name, value);
}

/**
 * What each plan entitlement is called on screen.
 *
 * Three screens list these — the marketing pricing page, the in-product plan switcher, and
 * anywhere a feature is gated — and two of them had written their own table. They disagreed:
 * "Advanced analytics" against "Advanced Rollups & CSV Exports" for the same flag. The second
 * is not a phrase a shop owner would use, or search for, or recognise on an invoice.
 *
 * Kept short. These appear as rows in a narrow column beside a tick, so the label names the
 * thing; the explaining is done by the screen that owns the feature.
 */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  ai_agent: 'AI employee',
  knowledge_base: 'Knowledge base',
  human_handoff: 'Hand over to your team',
  automations: 'Automations',
  analytics: 'Analytics',
  advanced_analytics: 'Advanced analytics and exports',
  multiple_numbers: 'Multiple WhatsApp numbers',
  campaigns: 'Broadcasts',
  appointments: 'Appointments',
  api_access: 'API access',
  priority_support: 'Priority support',
  audit_log_export: 'Activity log export',
};

export function planFeatureLabel(feature: PlanFeature): string {
  return PLAN_FEATURE_LABELS[feature] ?? humaniseCode(feature);
}
