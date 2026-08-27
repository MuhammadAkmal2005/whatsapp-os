/**
 * Validation schemas for contacts.
 *
 * The same schemas back the contact forms and the server actions, so the browser
 * and the server cannot disagree about what a valid customer record is.
 *
 * Two things are deliberately *not* done here.
 *
 * No `workspaceId`. Every operation resolves its scope from the session's tenant
 * context; accepting one from a form would mean posting another business's id and
 * having the server scope to the wrong tenant.
 *
 * No phone normalisation. The obvious move is `.transform(normalisePhone)`, and it
 * is wrong: which E.164 number `0300 1234567` becomes depends on the workspace's
 * country, which lives in `BusinessProfile` and needs a database read. A schema
 * that hard-coded `'PK'` would quietly file a British customer under +92. So the
 * schema checks the *shape* of what someone typed and the service does the
 * normalisation once it knows the country. See `contact.service.ts`.
 */

import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';

const NAME_MAX = 120;
const EMAIL_MAX = 254; // RFC 5321 upper bound on a forward path.
const SOURCE_MAX = 60;
const CITY_MAX = 80;
const ADDRESS_MAX = 200;
const POSTAL_CODE_MAX = 20;
const SEARCH_MAX = 80;
const NOTE_MAX = 4000;

export const CONTACT_STATUSES = ['LEAD', 'NEW', 'ACTIVE', 'RETURNING', 'VIP', 'INACTIVE', 'BLOCKED'] as const;
export const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'INTERESTED',
  'NEGOTIATION',
  'CONVERTED',
  'LOST',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];

const contactStatus = z.enum(CONTACT_STATUSES, {
  errorMap: () => ({ message: 'Choose a customer status.' }),
});

const leadStage = z.enum(LEAD_STAGES, {
  errorMap: () => ({ message: 'Choose a stage for this lead.' }),
});

export const contactId = z.string().uuid('That customer reference is not valid.');

/**
 * Everything past the shape check is the service's job.
 *
 * The bounds are wide on purpose: `+92 300 1234567`, `0300-1234567` and
 * `(0300) 1234567` are all things a shop owner will paste in, and rejecting them
 * at the boundary would push the person to guess at a format instead of letting
 * `normalisePhone` do what it exists for. What this does catch is input with no
 * chance of being a number, so the error arrives on the field rather than as a
 * failed save.
 */
const phoneInput = z
  .string()
  .trim()
  .min(1, 'Enter a WhatsApp number.')
  .max(32, 'That number is too long — check for extra digits.')
  .regex(/^[+0-9()\-.\s]+$/, 'A number can only contain digits, spaces and + ( ) - .')
  .refine((value) => (value.match(/\d/g)?.length ?? 0) >= 6, {
    message: 'That does not look like a complete phone number.',
  });

/** Blank and absent mean the same thing on a form, and both mean "no value stored". */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX, 'That email address is too long.')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: 'Enter a valid email address, like ahmed@example.com.',
  });

/**
 * An empty string clears the assignment, which is a different intent from leaving
 * the field alone. Both arrive as strings from a `<select>`, so the empty case is
 * mapped to null here rather than being rejected as a malformed uuid.
 */
const optionalMemberId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || z.string().uuid().safeParse(value).success, {
    message: 'That team member reference is not valid.',
  });

const contactFields = {
  name: optionalText(NAME_MAX, 'That name is too long.'),
  email: optionalEmail,
  status: contactStatus.optional(),
  leadStage: leadStage.optional(),
  source: optionalText(SOURCE_MAX, 'That source label is too long.'),
  /** BCP 47-ish, but free text: the agent handles Roman Urdu, which has no tag. */
  language: optionalText(16, 'That language code is too long.'),
  city: optionalText(CITY_MAX, 'That city name is too long.'),
  addressLine1: optionalText(ADDRESS_MAX, 'That address line is too long.'),
  addressLine2: optionalText(ADDRESS_MAX, 'That address line is too long.'),
  postalCode: optionalText(POSTAL_CODE_MAX, 'That postal code is too long.'),
};

export const createContactSchema = z.object({
  phone: phoneInput,
  /** Offered on creation, where there is no existing assignment to destroy. */
  assignedToMemberId: optionalMemberId,
  ...contactFields,
});

/**
 * The phone number is absent from the update schema on purpose.
 *
 * It is half of `@@unique([workspaceId, phoneE164])` — the contact's identity —
 * and editing it silently re-points every conversation, order and payment already
 * attached to the record at a different human. Changing who a contact *is* should
 * be a merge, which is its own operation with its own confirmation, so it is
 * recorded in the roadmap rather than smuggled into this form.
 *
 * `assignedToMemberId` is absent for a related reason. Every text field here is
 * write-through: a blank input means "clear it", because a form that posts all its
 * fields cannot distinguish blank from absent. Assignment cannot survive that rule —
 * the edit form does not offer it, so it would post nothing, and "clear it" is
 * exactly the wrong reading. Handing a customer to a colleague is `assignContact`,
 * which is also what the picker on the profile calls.
 */
export const updateContactSchema = z.object({
  contactId,
  ...contactFields,
});

export const deleteContactSchema = z.object({ contactId });

export const setContactStatusSchema = z.object({
  contactId,
  status: contactStatus,
});

export const setLeadStageSchema = z.object({
  contactId,
  leadStage,
});

export const assignContactSchema = z.object({
  contactId,
  assignedToMemberId: optionalMemberId,
});

export const addContactNoteSchema = z.object({
  contactId,
  body: z
    .string()
    .trim()
    .min(1, 'Write something before saving the note.')
    .max(NOTE_MAX, 'That note is too long. Keep it under 4,000 characters.'),
});

/**
 * List filters.
 *
 * `search` is bounded and trimmed because it reaches a database index — an
 * unbounded string here is a way to make Postgres do expensive work on request.
 * Cursor pagination rather than an offset, because a contact list changes under
 * the reader as messages arrive and `OFFSET` would show the same row twice.
 *
 * Assignment is one field with three meanings rather than three fields, because
 * they are mutually exclusive and separate booleans would let a caller ask for
 * something contradictory — "unassigned, but assigned to Ayesha" — which the
 * repository would then have to resolve by picking a winner.
 */
export const listContactsSchema = z.object({
  search: optionalText(SEARCH_MAX, 'Search for something shorter.'),
  status: contactStatus.optional(),
  leadStage: leadStage.optional(),
  /** `me` resolves from the session, so nobody can request another agent's book
   *  by posting their id — they can still filter by it explicitly, which the read
   *  permission already covers, but they cannot pose as them. */
  assignedTo: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))
    .refine(
      (value) =>
        value === null ||
        value === 'me' ||
        value === 'unassigned' ||
        z.string().uuid().safeParse(value).success,
      { message: 'That assignment filter is not valid.' },
    ),
  optedOut: z.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type DeleteContactInput = z.infer<typeof deleteContactSchema>;
export type SetContactStatusInput = z.infer<typeof setContactStatusSchema>;
export type SetLeadStageInput = z.infer<typeof setLeadStageSchema>;
export type AssignContactInput = z.infer<typeof assignContactSchema>;
export type AddContactNoteInput = z.infer<typeof addContactNoteSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  LEAD: 'Lead',
  NEW: 'New',
  ACTIVE: 'Active',
  RETURNING: 'Returning',
  VIP: 'VIP',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  INTERESTED: 'Interested',
  NEGOTIATION: 'Negotiation',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};
