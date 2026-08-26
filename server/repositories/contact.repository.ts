/**
 * Contacts — the customer records behind every conversation and order.
 *
 * Every function takes `workspaceId` and puts it in the `where` clause. On this
 * table that is the difference between a working product and handing a competitor
 * the phone number, address and order history of every customer a business has.
 *
 * Two conventions worth stating outright, because both are load-bearing:
 *
 * Writes use `updateMany` with the scope in the filter rather than `update` by id.
 * `update` would ignore the workspace and edit another tenant's row; `updateMany`
 * returns a count of zero, which the service turns into `NotFoundError`.
 *
 * Reads select `workspaceId` explicitly even though the caller already knows it,
 * so `assertBelongsToWorkspace` has something to check. A select that omitted it
 * would make the post-read assertion impossible to write, which is how the third
 * isolation layer quietly stops existing.
 *
 * Deletion is soft. A contact is referenced by conversations, orders and payments,
 * and a business that deletes a customer by accident should not lose the order
 * history that their accounts depend on. Every read filters `deletedAt: null`.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { ContactStatus, LeadStage } from '@/server/validation/contact';

export type ContactRow = {
  id: string;
  workspaceId: string;
  phoneE164: string;
  name: string | null;
  waProfileName: string | null;
  email: string | null;
  status: ContactStatus;
  leadStage: LeadStage;
  source: string | null;
  language: string | null;
  assignedToMemberId: string | null;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  totalOrders: number;
  totalSpentMinor: number;
  lastOrderAt: Date | null;
  lastInteractionAt: Date | null;
  optedOutAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Selected explicitly rather than with a bare `findMany`, so adding a column to
 *  Contact cannot silently start shipping it to the browser. */
const CONTACT_SELECT = {
  id: true,
  workspaceId: true,
  phoneE164: true,
  name: true,
  waProfileName: true,
  email: true,
  status: true,
  leadStage: true,
  source: true,
  language: true,
  assignedToMemberId: true,
  city: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  totalOrders: true,
  totalSpentMinor: true,
  lastOrderAt: true,
  lastInteractionAt: true,
  optedOutAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ContactFilters = {
  search: string | null;
  status?: ContactStatus;
  leadStage?: LeadStage;
  assignedToMemberId?: string | null;
  /** Distinguishes "show unassigned" from "do not filter on assignment". */
  unassignedOnly?: boolean;
  optedOut?: boolean;
  cursor?: string;
  limit: number;
};

export type ContactPage = {
  rows: ContactRow[];
  /** The id to pass back as `cursor` for the next page, or null at the end. */
  nextCursor: string | null;
};

/**
 * Builds the tenant-scoped filter for a list query.
 *
 * Private to this module: the `where` clause is the repository's business and a
 * service that could hand one in would be able to hand in a workspace too.
 */
function buildWhere(workspaceId: string, filters: ContactFilters) {
  const where: Record<string, unknown> = { workspaceId, deletedAt: null };

  if (filters.status) where.status = filters.status;
  if (filters.leadStage) where.leadStage = filters.leadStage;

  if (filters.unassignedOnly) {
    where.assignedToMemberId = null;
  } else if (filters.assignedToMemberId) {
    where.assignedToMemberId = filters.assignedToMemberId;
  }

  if (filters.optedOut === true) where.optedOutAt = { not: null };
  if (filters.optedOut === false) where.optedOutAt = null;

  if (filters.search) {
    const term = filters.search;
    // Digits only for the phone arm: someone searching "0300 1234" should match a
    // stored "+923001234567", and the space would otherwise guarantee no hit.
    const digits = term.replace(/\D/g, '');
    const or: Record<string, unknown>[] = [
      { name: { contains: term, mode: 'insensitive' } },
      { waProfileName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { city: { contains: term, mode: 'insensitive' } },
    ];
    if (digits.length >= 3) or.push({ phoneE164: { contains: digits } });
    where.OR = or;
  }

  return where;
}

/**
 * One page of contacts, newest first.
 *
 * Ordered by `createdAt` with `id` as a tiebreaker rather than by
 * `lastInteractionAt`, which is what the inbox sorts by. Two reasons: the column
 * is nullable, so a business with no messages yet would get an arbitrary order,
 * and cursor pagination needs the sort to end in something unique or a row can
 * appear on two consecutive pages.
 *
 * Cursor rather than offset because this list changes under the reader as
 * customers message in, and `OFFSET` would show the same contact twice.
 */
export async function listContacts(
  db: Db,
  workspaceId: string,
  filters: ContactFilters,
): Promise<ContactPage> {
  const rows = await db.contact.findMany({
    where: buildWhere(workspaceId, filters),
    select: CONTACT_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One more than asked for: its presence is how we know there is a next page
    // without a second COUNT over the same filter.
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    rows: page as ContactRow[],
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function findContactById(
  db: Db,
  workspaceId: string,
  contactId: string,
): Promise<ContactRow | null> {
  const row = await db.contact.findFirst({
    where: { id: contactId, workspaceId, deletedAt: null },
    select: CONTACT_SELECT,
  });
  return (row as ContactRow | null) ?? null;
}

/**
 * Looks a contact up by its identity key.
 *
 * The inbound-message path calls this on every message, which is why the unique
 * index `(workspaceId, phoneE164)` exists — and why `phoneE164` must already be
 * normalised before it gets here. An un-normalised argument silently misses.
 */
export async function findContactByPhone(
  db: Db,
  workspaceId: string,
  phoneE164: string,
): Promise<ContactRow | null> {
  const row = await db.contact.findFirst({
    where: { workspaceId, phoneE164, deletedAt: null },
    select: CONTACT_SELECT,
  });
  return (row as ContactRow | null) ?? null;
}

/**
 * The soft-deleted row for a phone number, if there is one.
 *
 * Separate from `findContactByPhone` because the unique index does not know about
 * `deletedAt`: re-adding a customer who was deleted last month collides with the
 * old row rather than inserting. The service restores instead, which also gives
 * the business their order history back.
 */
export async function findDeletedContactByPhone(
  db: Db,
  workspaceId: string,
  phoneE164: string,
): Promise<{ id: string; workspaceId: string } | null> {
  return db.contact.findFirst({
    where: { workspaceId, phoneE164, deletedAt: { not: null } },
    select: { id: true, workspaceId: true },
  });
}

export async function countContacts(db: Db, workspaceId: string): Promise<number> {
  return db.contact.count({ where: { workspaceId, deletedAt: null } });
}

export type ContactWriteFields = {
  name: string | null;
  email: string | null;
  status?: ContactStatus;
  leadStage?: LeadStage;
  source: string | null;
  language: string | null;
  assignedToMemberId: string | null;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
};

export async function createContact(
  db: Db,
  input: ContactWriteFields & { workspaceId: string; phoneE164: string },
): Promise<ContactRow> {
  const row = await db.contact.create({
    data: {
      workspaceId: input.workspaceId,
      phoneE164: input.phoneE164,
      name: input.name,
      email: input.email,
      status: input.status,
      leadStage: input.leadStage,
      source: input.source,
      language: input.language,
      assignedToMemberId: input.assignedToMemberId,
      city: input.city,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      postalCode: input.postalCode,
    },
    select: CONTACT_SELECT,
  });
  return row as ContactRow;
}

export async function updateContact(
  db: Db,
  workspaceId: string,
  contactId: string,
  data: Partial<ContactWriteFields>,
): Promise<number> {
  const result = await db.contact.updateMany({
    where: { id: contactId, workspaceId, deletedAt: null },
    data,
  });
  return result.count;
}

export async function softDeleteContact(
  db: Db,
  workspaceId: string,
  contactId: string,
  at: Date,
): Promise<number> {
  const result = await db.contact.updateMany({
    where: { id: contactId, workspaceId, deletedAt: null },
    data: { deletedAt: at },
  });
  return result.count;
}

/**
 * Brings a soft-deleted contact back and applies the details supplied this time.
 *
 * Scoped on `deletedAt: { not: null }` so this can only ever act on a deleted row
 * — a caller confusing this with `updateContact` cannot silently overwrite a live
 * customer's record.
 */
export async function restoreContact(
  db: Db,
  workspaceId: string,
  contactId: string,
  data: ContactWriteFields,
): Promise<number> {
  const result = await db.contact.updateMany({
    where: { id: contactId, workspaceId, deletedAt: { not: null } },
    data: { ...data, deletedAt: null },
  });
  return result.count;
}

/** Counts per status for the filter chips, in one grouped query rather than one
 *  query per status. */
export async function countContactsByStatus(
  db: Db,
  workspaceId: string,
): Promise<Record<string, number>> {
  const groups = await db.contact.groupBy({
    by: ['status'],
    where: { workspaceId, deletedAt: null },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}

// ── Notes ──────────────────────────────────────────────────────────────────

export type ContactNoteRow = {
  id: string;
  workspaceId: string;
  contactId: string;
  body: string;
  createdAt: Date;
  author: { id: string; user: { name: string } } | null;
};

const NOTE_SELECT = {
  id: true,
  workspaceId: true,
  contactId: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, user: { select: { name: true } } } },
} as const;

export async function listContactNotes(
  db: Db,
  workspaceId: string,
  contactId: string,
): Promise<ContactNoteRow[]> {
  const rows = await db.contactNote.findMany({
    // Both ids in the filter. `contactId` alone would be enough given it is a
    // uuid, but relying on that is relying on an attacker not guessing one.
    where: { workspaceId, contactId },
    select: NOTE_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return rows as ContactNoteRow[];
}

export async function createContactNote(
  db: Db,
  input: {
    workspaceId: string;
    contactId: string;
    authorMemberId: string | null;
    body: string;
  },
): Promise<{ id: string }> {
  return db.contactNote.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      authorMemberId: input.authorMemberId,
      body: input.body,
    },
    select: { id: true },
  });
}
