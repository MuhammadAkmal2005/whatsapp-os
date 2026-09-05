/**
 * Contact service.
 *
 * Where authorization for customer records happens, and where a typed phone number
 * becomes an identity.
 *
 * The interesting logic here is not the CRUD. It is the four things that go wrong
 * quietly if nobody writes them down:
 *
 *   1. **Normalisation belongs here, not in the schema.** `0300 1234567` is a
 *      different human depending on the workspace's country, and the country is a
 *      database read. Doing it in Zod would mean hard-coding `'PK'` and filing a
 *      British customer under +92.
 *   2. **A duplicate is a normal outcome.** Two people typing the same customer in,
 *      or a form resubmitted, must not create a second record — the whole point of
 *      normalising is that one human is one contact. The uniqueness check and the
 *      P2002 catch are both needed, because between the check and the insert is a
 *      race.
 *   3. **A soft-deleted contact still occupies the unique index.** Re-adding a
 *      customer deleted last month collides rather than inserting, so this restores
 *      the row instead, which also gives the business their order history back.
 *   4. **The plan limit is checked against live rows.** A business at 100 contacts
 *      on the free plan is told the limit, not shown a failed save.
 */

import 'server-only';

import { getPlan } from '@/config/plans';
import { isUniqueConstraintViolation, prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { maskPhone, normalisePhone } from '@/lib/phone';
import { BusinessRuleError, ConflictError, LimitExceededError, NotFoundError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { assertWithinPlanLimit } from '@/server/services/billing/limit-guard.service';
import {
  countContacts,
  countContactsByStatus,
  createContact as createContactRow,
  createContactNote,
  findContactById,
  findContactByPhone,
  findDeletedContactByPhone,
  listContactNotes,
  listContacts,
  restoreContact,
  softDeleteContact,
  updateContact as updateContactRow,
  type ContactNoteRow,
  type ContactRow,
  type ContactWriteFields,
} from '@/server/repositories/contact.repository';
import {
  getCustomerLifecycle,
  type CustomerLifecycleResult,
} from '@/server/services/lifecycle/lifecycle.service';
import {
  findMemberById,
  listMembers,
  type MemberRow,
} from '@/server/repositories/member.repository';
import { getWorkspaceCountry } from '@/server/repositories/workspace.repository';
import {
  contactCapability,
  contactDetailCapability,
  contactListCapability,
  type ContactCapability,
  type ContactDetailCapability,
  type ContactListCapability,
} from '@/server/services/contact/contact.capability';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  AddContactNoteInput,
  AssignContactInput,
  CreateContactInput,
  ListContactsInput,
  SetContactStatusInput,
  SetLeadStageInput,
  UpdateContactInput,
} from '@/server/validation/contact';

/** A zero row count from a scoped write means the id was not in this workspace.
 *  NotFound, never Forbidden — a 403 would confirm the id exists elsewhere. */
function assertTouched(count: number, what = 'Customer'): void {
  if (count === 0) throw new NotFoundError(what);
}

/**
 * Turns typed input into the identity key, or refuses.
 *
 * Refusing is the right answer for an uninterpretable number: a guess produces a
 * contact that can never receive a message and can never be merged with the real
 * one. `lib/phone` is deliberately strict about this and returns null rather than
 * inventing a country code.
 */
function toIdentity(input: string, country: string): { phoneE164: string } {
  const normalised = normalisePhone(input, country);
  if (!normalised) {
    throw new BusinessRuleError(
      'That does not look like a WhatsApp number we can reach. Include the country code, like +92 300 1234567.',
    );
  }
  return { phoneE164: normalised.e164 };
}

export type Contact = ContactRow & {
  /** Resolved for display so a list row does not need a second lookup per contact. */
  assignedToName: string | null;
  /** What the *caller* may do to this record. Rendering convenience; the service
   *  enforces the same rules regardless of what the UI chose to show. */
  can: ContactCapability;
};

export type ContactNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
};

export type ContactListPage = {
  contacts: Contact[];
  nextCursor: string | null;
  statusCounts: Record<string, number>;
  /** Live row count against the plan ceiling, so the page can warn before a save
   *  fails rather than after. */
  usage: { used: number; limit: number | null };
  assignees: { id: string; name: string }[];
  can: ContactListCapability;
};

function toContact(
  row: ContactRow,
  assigneeNames: Map<string, string>,
  capability: Contact['can'],
): Contact {
  return {
    ...row,
    assignedToName: row.assignedToMemberId
      ? (assigneeNames.get(row.assignedToMemberId) ?? null)
      : null,
    can: capability,
  };
}

function toNote(row: ContactNoteRow): ContactNote {
  return {
    id: row.id,
    body: row.body,
    // A note whose author has since left the team still has to render. "Removed
    // team member" is honest; an empty byline looks like a bug.
    authorName: row.author?.user.name ?? 'Removed team member',
    createdAt: row.createdAt,
  };
}

/**
 * Splits the team into "names for display" and "people who may be assigned".
 *
 * They are not the same set, and conflating them is a small bug with an annoying
 * shape. A suspended member keeps their name on the customers they already hold,
 * because a blank byline reads as data loss — but they must not be offered as a new
 * assignee, since they cannot open the conversation to act on it. The customer would
 * sit in a queue nobody is watching.
 */
function assigneeView(members: MemberRow[]): {
  names: Map<string, string>;
  options: { id: string; name: string }[];
} {
  return {
    names: new Map(members.map((member) => [member.id, member.user.name])),
    options: members
      .filter((member) => member.status === 'ACTIVE')
      .map((member) => ({ id: member.id, name: member.user.name })),
  };
}

export async function getContacts(
  ctx: TenantContext,
  input: ListContactsInput,
): Promise<ContactListPage> {
  requirePermission(ctx, 'contact:read');

  // `me` resolves from the context, so a caller cannot ask for another member's
  // book by posting their id under the guise of being them.
  const assignment =
    input.assignedTo === 'me'
      ? { assignedToMemberId: ctx.membershipId }
      : input.assignedTo === 'unassigned'
        ? { unassignedOnly: true }
        : input.assignedTo
          ? { assignedToMemberId: input.assignedTo }
          : {};

  const [page, statusCounts, used, members] = await Promise.all([
    listContacts(prisma, ctx.workspaceId, {
      search: input.search,
      status: input.status,
      leadStage: input.leadStage,
      ...assignment,
      optedOut: input.optedOut,
      cursor: input.cursor,
      limit: input.limit,
    }),
    countContactsByStatus(prisma, ctx.workspaceId),
    countContacts(prisma, ctx.workspaceId),
    listMembers(prisma, ctx.workspaceId),
  ]);

  const assignees = assigneeView(members);
  const capability = contactCapability(ctx);

  return {
    contacts: page.rows.map((row) => toContact(row, assignees.names, capability)),
    nextCursor: page.nextCursor,
    statusCounts,
    usage: { used, limit: getPlan(ctx.planKey).limits.contacts },
    assignees: assignees.options,
    can: contactListCapability(ctx),
  };
}

export type ContactDetail = {
  contact: Contact;
  notes: ContactNote[];
  assignees: { id: string; name: string }[];
  lifecycle?: CustomerLifecycleResult | null;
  can: ContactDetailCapability;
};

export async function getContact(ctx: TenantContext, contactId: string): Promise<ContactDetail> {
  requirePermission(ctx, 'contact:read');

  const row = await findContactById(prisma, ctx.workspaceId, contactId);
  // The repository already scoped the query; this is the redundant third layer,
  // and it is what catches a query someone later writes without the scope.
  if (!row || row.workspaceId !== ctx.workspaceId) throw new NotFoundError('Customer');

  const [notes, members, lifecycle] = await Promise.all([
    listContactNotes(prisma, ctx.workspaceId, contactId),
    listMembers(prisma, ctx.workspaceId),
    getCustomerLifecycle(prisma, ctx.workspaceId, contactId).catch(() => null),
  ]);

  const assignees = assigneeView(members);
  const capability = contactDetailCapability(ctx);

  return {
    contact: toContact(row, assignees.names, capability),
    notes: notes.map(toNote),
    assignees: assignees.options,
    lifecycle,
    can: capability,
  };
}

/**
 * Confirms an assignee is an active member of *this* workspace before storing their id.
 *
 * Without the workspace check, a crafted form post could attach a competitor's staff
 * member to a customer record — the foreign key would accept it, because it points at
 * `workspace_members` globally rather than at this workspace's slice of it.
 *
 * The status check is a product rule rather than a security one: a suspended member
 * cannot open the conversation, so assigning a customer to them parks that customer
 * in a queue nobody reads.
 */
async function resolveAssignee(
  ctx: TenantContext,
  memberId: string | null,
): Promise<string | null> {
  if (!memberId) return null;
  const member = await findMemberById(prisma, ctx.workspaceId, memberId);
  if (!member) throw new NotFoundError('Team member');
  if (member.status !== 'ACTIVE') {
    throw new BusinessRuleError(
      `${member.user.name}'s access is suspended, so customers cannot be assigned to them.`,
    );
  }
  return member.id;
}

type AuditMeta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * Maps validated input onto the columns the repository writes.
 *
 * `assignedToMemberId` is passed separately rather than read from `input`, and it is
 * allowed to be `undefined`: Prisma treats an undefined value as "leave this column
 * alone", which is how the edit path avoids clearing an assignment it never asked
 * about. `null` still means "clear it" — that distinction is the whole point of the
 * third state.
 */
function writeFields(
  input: Omit<CreateContactInput, 'phone' | 'assignedToMemberId'> | Omit<UpdateContactInput, 'contactId'>,
  assignedToMemberId: string | null | undefined,
): ContactWriteFields {
  return {
    name: input.name,
    email: input.email,
    status: input.status,
    leadStage: input.leadStage,
    source: input.source,
    language: input.language,
    assignedToMemberId,
    city: input.city,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    postalCode: input.postalCode,
  };
}

export async function createContact(
  ctx: TenantContext,
  input: CreateContactInput,
  meta?: AuditMeta,
): Promise<Contact> {
  requirePermission(ctx, 'contact:create');

  const country = await getWorkspaceCountry(prisma, ctx.workspaceId);
  const { phoneE164 } = toIdentity(input.phone, country);

  const existing = await findContactByPhone(prisma, ctx.workspaceId, phoneE164);
  if (existing) {
    throw new ConflictError(
      `${existing.name ?? phoneE164} is already saved as a customer with this number.`,
    );
  }

  await assertWithinPlanLimit(ctx, 'contacts', 1, prisma);

  const assignedToMemberId = await resolveAssignee(ctx, input.assignedToMemberId);
  const fields = writeFields(input, assignedToMemberId);

  // A previously deleted contact still holds the unique index, so this is a
  // restore rather than an insert. The business gets their order history back,
  // which is what they want and would not have thought to ask for.
  const deleted = await findDeletedContactByPhone(prisma, ctx.workspaceId, phoneE164);
  if (deleted) {
    assertTouched(await restoreContact(prisma, ctx.workspaceId, deleted.id, fields));
    await audit(ctx, 'contact.restored', deleted.id, { phone: maskPhone(phoneE164) }, meta);
    return getContactOrThrow(ctx, deleted.id);
  }

  let row: ContactRow;
  try {
    row = await createContactRow(prisma, {
      workspaceId: ctx.workspaceId,
      phoneE164,
      ...fields,
    });
  } catch (error) {
    // Lost the race against a concurrent insert of the same number. Not an
    // error condition in the product sense — the record the caller wanted now
    // exists, so say so plainly rather than showing a 500.
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError('That customer was just saved by someone else on your team.');
    }
    throw error;
  }

  await audit(ctx, 'contact.created', row.id, { phone: maskPhone(phoneE164) }, meta);

  return getContactOrThrow(ctx, row.id);
}

export async function updateContact(
  ctx: TenantContext,
  input: UpdateContactInput,
  meta?: AuditMeta,
): Promise<Contact> {
  requirePermission(ctx, 'contact:update');

  // `undefined`, not the result of `resolveAssignee`: this path does not touch the
  // assignment at all. See the note on `updateContactSchema`.
  const fields = writeFields(input, undefined);

  assertTouched(await updateContactRow(prisma, ctx.workspaceId, input.contactId, fields));
  await audit(ctx, 'contact.updated', input.contactId, null, meta);

  return getContactOrThrow(ctx, input.contactId);
}

export async function setContactStatus(
  ctx: TenantContext,
  input: SetContactStatusInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'contact:update');
  assertTouched(
    await updateContactRow(prisma, ctx.workspaceId, input.contactId, { status: input.status }),
  );
  await audit(ctx, 'contact.status_changed', input.contactId, { status: input.status }, meta);
}

export async function setLeadStage(
  ctx: TenantContext,
  input: SetLeadStageInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'contact:update');
  assertTouched(
    await updateContactRow(prisma, ctx.workspaceId, input.contactId, {
      leadStage: input.leadStage,
    }),
  );
  await audit(ctx, 'contact.lead_stage_changed', input.contactId, { stage: input.leadStage }, meta);
}

export async function assignContact(
  ctx: TenantContext,
  input: AssignContactInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'contact:update');
  const assignedToMemberId = await resolveAssignee(ctx, input.assignedToMemberId);
  assertTouched(
    await updateContactRow(prisma, ctx.workspaceId, input.contactId, { assignedToMemberId }),
  );
  await audit(ctx, 'contact.assigned', input.contactId, { assignedToMemberId }, meta);
}

/**
 * Soft delete. The row stays, so conversations, orders and payments that point at
 * it keep resolving and the business does not lose their sales history to a
 * mis-click.
 */
export async function deleteContact(
  ctx: TenantContext,
  contactId: string,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'contact:delete');
  assertTouched(await softDeleteContact(prisma, ctx.workspaceId, contactId, new Date()));
  await audit(ctx, 'contact.deleted', contactId, null, meta);
}

export async function addContactNote(
  ctx: TenantContext,
  input: AddContactNoteInput,
  meta?: AuditMeta,
): Promise<ContactNote> {
  requirePermission(ctx, 'contact:update');

  // Confirms the contact is ours before writing a child row against its id. A note
  // is scoped by `workspaceId` too, so a foreign id would produce an orphan the
  // owning workspace could never see — a silent write into nowhere.
  const contact = await findContactById(prisma, ctx.workspaceId, input.contactId);
  if (!contact || contact.workspaceId !== ctx.workspaceId) throw new NotFoundError('Customer');

  const created = await createContactNote(prisma, {
    workspaceId: ctx.workspaceId,
    contactId: input.contactId,
    authorMemberId: ctx.membershipId,
    body: input.body,
  });

  return {
    id: created.id,
    body: input.body,
    authorName: ctx.user.name,
    createdAt: new Date(),
  };
}

/** Re-reads after a write so the caller gets the persisted row rather than an
 *  optimistic reconstruction of it, which is how a display drifts from the truth. */
async function getContactOrThrow(ctx: TenantContext, contactId: string): Promise<Contact> {
  const row = await findContactById(prisma, ctx.workspaceId, contactId);
  if (!row || row.workspaceId !== ctx.workspaceId) throw new NotFoundError('Customer');

  const members = await listMembers(prisma, ctx.workspaceId);

  return toContact(row, assigneeView(members).names, contactCapability(ctx));
}

/**
 * Audit writes are best-effort by design.
 *
 * The customer's record has already been saved at this point. Failing the whole
 * request because the audit insert failed would discard completed work and teach
 * the person that saving is unreliable. The failure is logged loudly instead, and
 * a missing audit row is a monitoring problem rather than a data-loss one.
 *
 * Note the phone number is masked before it reaches the metadata. An audit log is
 * read by more people than the contact list is.
 */
async function audit(
  ctx: TenantContext,
  action: string,
  contactId: string,
  metadata: Record<string, unknown> | null,
  meta?: AuditMeta,
): Promise<void> {
  try {
    await appendAuditLog(prisma, {
      action,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      resourceType: 'Contact',
      resourceId: contactId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata,
    });
  } catch (error) {
    logger.error('Failed to write contact audit log', {
      action,
      contactId,
      workspaceId: ctx.workspaceId,
      error,
    });
  }
}
