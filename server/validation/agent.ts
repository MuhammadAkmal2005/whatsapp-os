/**
 * AI agent configuration shapes.
 *
 * One schema backs both the form and the server action, so the two cannot disagree about
 * what a shop owner is allowed to save.
 *
 * This is a strict allow-list, and that is the point of the file. An `AIAgent` row carries
 * columns that must never travel from a browser — the workspace it belongs to, its usage
 * counters, its timestamps, and the model identifier the deployment stamped on it. Rather
 * than filtering those out after parsing, the schema simply has no members for them:
 * stripping unknown keys is Zod's default, so an injected `workspaceId` or
 * `conversationsHandled` is gone before the service is called, and the update statement is
 * built from named fields only.
 *
 * Everything here parses what an HTML form posts — strings — because that is the only
 * caller. The output types are the real ones, so the service receives numbers and booleans
 * and never has to know a browser was involved.
 */

import { z } from 'zod';

import { AGENT_CONFIG_LIMITS } from '@/config/constants';

/**
 * The `AgentRole` enum, as strings.
 *
 * Duplicated from the Prisma enum rather than imported from `@prisma/client` because this
 * module is imported by client components — the form needs the option list — and the
 * generated client is server-only. The order is the order the picker renders in, which is
 * why `SALES_SUPPORT` leads: it is the schema default and the job most small shops want.
 */
export const AGENT_ROLES = [
  'SALES_SUPPORT',
  'SALES',
  'SUPPORT',
  'ORDER_TAKER',
  'RECEPTIONIST',
  'FOLLOW_UP',
] as const;

/**
 * Suffixed `Value` because `@prisma/client` exports an `AgentRole` too, and the repository
 * imports it. Two identically-named types for the same six strings — one safe in a browser
 * bundle, one not — is the kind of collision that gets resolved by whichever import came last.
 */
export type AgentRoleValue = (typeof AGENT_ROLES)[number];

export const AGENT_TONES = [
  'FRIENDLY',
  'PROFESSIONAL',
  'CASUAL',
  'LUXURY',
  'CONCISE',
  'DETAILED',
] as const;

export type AgentToneValue = (typeof AGENT_TONES)[number];

/**
 * Whether a posted string names one of the six jobs, and likewise one of the six tones.
 *
 * A rejected save is re-rendered from what the owner posted rather than from the database, so
 * the form has to put a string from `FormData` back into a typed picker. Both pickers can only
 * ever post one of their own options, so a value that fails these guards means something other
 * than the screen sent it — and the honest answer there is the stored value, not the string.
 */
export function isAgentRole(value: string): value is AgentRoleValue {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

export function isAgentTone(value: string): value is AgentToneValue {
  return (AGENT_TONES as readonly string[]).includes(value);
}

/**
 * The jobs the runtime grants order-writing tools to.
 *
 * Mirrors `deriveCapabilitiesForAgent` in the runtime, and exported so the form can tell the
 * owner which choices let their assistant place an order on a customer's behalf. A picker
 * that hides that is a picker that quietly changes what the AI is allowed to do.
 */
export const ORDER_CAPABLE_AGENT_ROLES: readonly AgentRoleValue[] = [
  'SALES_SUPPORT',
  'SALES',
  'ORDER_TAKER',
];

/**
 * Empty string means "cleared", not "unchanged".
 *
 * An HTML form always posts its text fields, so a persona the owner has deleted arrives as
 * `''`. Storing that would put an empty line in the system prompt where the column means "no
 * persona at all", so it is normalised to null here — once, in the schema, for every optional
 * text field on the screen.
 */
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .max(max, tooLong)
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .default(null);
}

/**
 * Blank is missing, not zero.
 *
 * `formData.get` returns `''` for an emptied number input and `z.coerce.number()` reads `''`
 * as `0`. Left alone, an owner who clears the reply-length box would be saving "zero tokens",
 * which reads as a successful save and produces an assistant that says nothing.
 */
const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

/**
 * A switch is not a boolean, and the difference breaks in the direction that matters.
 *
 * `z.coerce.boolean()` reads the string `'false'` as `true`, because every non-empty string is
 * truthy — which would turn "switch my assistant off" into "leave it on". Hence an explicit
 * mapping over the values a form actually sends. The form posts a hidden field alongside the
 * switch so a value is always present.
 */
const flagInput = z
  .union([z.boolean(), z.enum(['true', 'false', 'on', 'off', '1', '0'])])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === 'on' || value === '1';
  });

/**
 * Splits the textarea the form posts into separate words.
 *
 * Newline *or* comma, because both are what people type into a box that says "one per line".
 * Blank entries are dropped rather than rejected: a trailing newline is not a mistake the
 * owner should have to go back and fix.
 */
export function parseHandoffKeywordList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The inverse, for rendering the saved list back into the textarea. */
export function formatHandoffKeywordList(keywords: readonly string[]): string {
  return keywords.join('\n');
}

/**
 * Trimmed, lower-cased, de-duplicated, first-seen order preserved.
 *
 * Lower-casing is not cosmetic: the runtime lower-cases the inbound message and compares with
 * `includes`, so a stored `"Manager"` would never match and the owner would have no way to see
 * why. De-duplication happens after that, so `"Manager"` and `"manager"` collapse into one
 * rather than both being tested against every message that arrives.
 */
export function normaliseHandoffKeywords(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const entry of entries) {
    const keyword = entry.trim().toLowerCase();
    if (keyword.length === 0 || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
}

/**
 * The handoff list, from either a textarea or an array.
 *
 * Normalised *before* the count is checked, so a list of thirty words that collapses to twelve
 * is accepted rather than being rejected for a size it does not have once saved.
 */
const handoffKeywordsSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    return typeof value === 'string' ? parseHandoffKeywordList(value) : value;
  },
  z
    .array(z.string())
    .transform(normaliseHandoffKeywords)
    .refine((keywords) => keywords.length <= AGENT_CONFIG_LIMITS.handoffKeywordsMax, {
      message: `Use at most ${AGENT_CONFIG_LIMITS.handoffKeywordsMax} handover words. If you need more than that, you want a rule rather than a word list.`,
    })
    .refine(
      (keywords) =>
        keywords.every((keyword) => keyword.length <= AGENT_CONFIG_LIMITS.handoffKeywordMax),
      {
        message: `Each handover word must be ${AGENT_CONFIG_LIMITS.handoffKeywordMax} characters or fewer.`,
      },
    )
    .default([]),
);

const TEMPERATURE_RANGE = `Pick a value between ${AGENT_CONFIG_LIMITS.temperatureMin} and ${AGENT_CONFIG_LIMITS.temperatureMax}.`;
const REPLY_LENGTH_RANGE = `Pick a reply length between ${AGENT_CONFIG_LIMITS.maxOutputTokensMin} and ${AGENT_CONFIG_LIMITS.maxOutputTokensMax}.`;

/**
 * Everything a shop owner may change about their assistant.
 *
 * Deliberately absent, each for a reason recorded in the phase report: `model` (the deployment
 * stamps it, and only one provider adapter is wired), `confidenceFloor`, `businessHoursOnly`,
 * `escalationRules` and `languages` (stored, but nothing in the runtime reads them yet),
 * `isDefault` (one assistant per workspace, so the flag has nothing to express), and every
 * identity, counter and timestamp column.
 *
 * `isActive` is here because it is the one switch with immediate, visible consequences: off
 * means no automatic replies to anybody.
 */
export const updateAgentConfigSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give your assistant a name — customers see it in the chat.')
    .max(AGENT_CONFIG_LIMITS.nameMax, `Use ${AGENT_CONFIG_LIMITS.nameMax} characters or fewer.`),
  role: z.enum(AGENT_ROLES, { message: 'Choose one of the listed jobs.' }),
  tone: z.enum(AGENT_TONES, { message: 'Choose one of the listed styles.' }),
  persona: optionalText(
    AGENT_CONFIG_LIMITS.personaMax,
    `Keep the style note to ${AGENT_CONFIG_LIMITS.personaMax} characters — a sentence or two works best.`,
  ),
  greeting: optionalText(
    AGENT_CONFIG_LIMITS.greetingMax,
    `Keep the greeting to ${AGENT_CONFIG_LIMITS.greetingMax} characters or fewer.`,
  ),
  customInstructions: optionalText(
    AGENT_CONFIG_LIMITS.customInstructionsMax,
    `Keep your instructions to ${AGENT_CONFIG_LIMITS.customInstructionsMax} characters or fewer.`,
  ),
  handoffKeywords: handoffKeywordsSchema,
  temperature: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ required_error: TEMPERATURE_RANGE, invalid_type_error: TEMPERATURE_RANGE })
      .finite(TEMPERATURE_RANGE)
      .min(AGENT_CONFIG_LIMITS.temperatureMin, TEMPERATURE_RANGE)
      .max(AGENT_CONFIG_LIMITS.temperatureMax, TEMPERATURE_RANGE),
  ),
  maxOutputTokens: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ required_error: REPLY_LENGTH_RANGE, invalid_type_error: REPLY_LENGTH_RANGE })
      .int('Reply length has to be a whole number.')
      .min(AGENT_CONFIG_LIMITS.maxOutputTokensMin, REPLY_LENGTH_RANGE)
      .max(AGENT_CONFIG_LIMITS.maxOutputTokensMax, REPLY_LENGTH_RANGE),
  ),
  isActive: flagInput,
});

/** What the service receives: parsed, normalised, and nothing else. */
export type UpdateAgentConfigInput = z.infer<typeof updateAgentConfigSchema>;
