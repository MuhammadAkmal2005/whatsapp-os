/**
 * Instruction #96, against a real database.
 *
 * `tests/unit/tenant-isolation.test.ts` proves the assertion helper refuses a foreign
 * row. That test would still pass if a repository forgot to call it. This one goes
 * through the service, which is what a route actually calls, and asks the question the
 * instruction asks: create a customer, a note and an assignment inside Workspace A,
 * then try to reach and change them holding Workspace B's context.
 *
 * Requires Postgres. `npm test` starts nothing — bring up the throwaway container
 * first with `docker compose up -d postgres-test` and apply the schema to it, as
 * described in `docs/TESTING.md`. Without it this file fails at the first query,
 * which is the intended behaviour: silently skipping the isolation suite is how a
 * tenant boundary goes unverified for a month.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/server/errors';
import {
  addContactNote,
  assignContact,
  deleteContact,
  getContact,
  getContacts,
  setContactStatus,
  setLeadStage,
  updateContact,
} from '@/server/services/contact/contact.service';
import {
  createContactFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

const REQUEST_META = { ipAddress: '203.0.113.10', userAgent: 'vitest' };

let workspaceA: WorkspaceFixture;
let workspaceB: WorkspaceFixture;
let contactInA: { id: string; phoneE164: string; name: string };

beforeEach(async () => {
  await resetDatabase();

  workspaceA = await createWorkspaceFixture({ name: 'Akmal Fashion' });
  workspaceB = await createWorkspaceFixture({ name: 'Lahore Threads' });
  contactInA = await createContactFixture(workspaceA.workspaceId, { name: 'Fatima Sheikh' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reading another workspace’s customer', () => {
  it('lets Workspace A read its own customer', async () => {
    const detail = await getContact(workspaceA.context, contactInA.id);
    expect(detail.contact.id).toBe(contactInA.id);
    expect(detail.contact.name).toBe('Fatima Sheikh');
  });

  it('refuses Workspace B the same customer', async () => {
    await expect(getContact(workspaceB.context, contactInA.id)).rejects.toThrow(NotFoundError);
  });

  /**
   * The distinction the instruction is really about. A 403 would confirm the id is
   * real, which turns a leaked link into a way to establish that a competitor has a
   * customer — and, repeated, to size their book.
   */
  it('reports it as not found rather than forbidden', async () => {
    const error = await getContact(workspaceB.context, contactInA.id).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).not.toBeInstanceOf(ForbiddenError);
    expect((error as NotFoundError).status).toBe(404);
  });

  it('answers identically for a foreign customer and one that never existed', async () => {
    const foreign = await getContact(workspaceB.context, contactInA.id).catch(
      (error: unknown) => error as NotFoundError,
    );
    const missing = await getContact(
      workspaceB.context,
      '99999999-9999-4999-8999-999999999999',
    ).catch((error: unknown) => error as NotFoundError);

    expect(foreign.code).toBe(missing.code);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.message).toBe(missing.message);
  });

  it('keeps the customer out of Workspace B’s list entirely', async () => {
    const page = await getContacts(workspaceB.context, {
      search: null,
      assignedTo: null,
      cursor: undefined,
      limit: 25,
    });

    expect(page.contacts).toHaveLength(0);
    expect(page.usage.used).toBe(0);
  });

  it('does not leak the customer through a search for their name', async () => {
    const page = await getContacts(workspaceB.context, {
      search: 'Fatima',
      assignedTo: null,
      cursor: undefined,
      limit: 25,
    });

    expect(page.contacts).toHaveLength(0);
  });

  /**
   * A cursor is a real id from a real page, and a leaked one is the most plausible way
   * a foreign id ends up in a query: copied out of a URL. Paginating with it must not
   * become a way to walk into another tenant's rows.
   *
   * Either outcome is acceptable — Prisma may reject a cursor that its `where` clause
   * excludes, or return nothing — so the assertion is on the property that matters
   * rather than on which of the two Prisma happens to do. Pinning the mechanism would
   * make this test a Prisma version detector instead of a tenancy test.
   */
  it('does not walk into the other workspace from a leaked cursor', async () => {
    const outcome = await getContacts(workspaceB.context, {
      search: null,
      assignedTo: null,
      cursor: contactInA.id,
      limit: 25,
    }).catch(() => null);

    if (outcome) {
      expect(outcome.contacts.map((contact) => contact.id)).not.toContain(contactInA.id);
    }
  });
});

describe('writing to another workspace’s customer', () => {
  it('refuses an edit', async () => {
    await expect(
      updateContact(
        workspaceB.context,
        {
          contactId: contactInA.id,
          name: 'Renamed by another business',
          email: null,
          source: null,
          language: null,
          city: null,
          addressLine1: null,
          addressLine2: null,
          postalCode: null,
        },
        REQUEST_META,
      ),
    ).rejects.toThrow(NotFoundError);

    const untouched = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(untouched.name).toBe('Fatima Sheikh');
  });

  it('refuses a status change', async () => {
    await expect(
      setContactStatus(
        workspaceB.context,
        { contactId: contactInA.id, status: 'BLOCKED' },
        REQUEST_META,
      ),
    ).rejects.toThrow(NotFoundError);

    const untouched = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(untouched.status).toBe('LEAD');
  });

  it('refuses a lead stage change', async () => {
    await expect(
      setLeadStage(workspaceB.context, { contactId: contactInA.id, leadStage: 'LOST' }, REQUEST_META),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses a note', async () => {
    await expect(
      addContactNote(
        workspaceB.context,
        { contactId: contactInA.id, body: 'Written from the wrong workspace.' },
        REQUEST_META,
      ),
    ).rejects.toThrow(NotFoundError);

    const notes = await prisma.contactNote.count({ where: { contactId: contactInA.id } });
    expect(notes).toBe(0);
  });

  it('refuses a removal, and the customer survives', async () => {
    await expect(
      deleteContact(workspaceB.context, contactInA.id, REQUEST_META),
    ).rejects.toThrow(NotFoundError);

    const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(survivor.deletedAt).toBeNull();
  });
});

describe('assigning across the boundary', () => {
  /**
   * The subtler direction, and the one a foreign key does not catch. `assignedToMemberId`
   * points at `workspace_members` globally, so the database would happily attach a
   * competitor's employee to this customer — parking the record in a queue inside
   * another business, where its notes and phone number would then be visible.
   */
  it('refuses a member from another workspace as the assignee', async () => {
    const outsider = await createMemberFixture(workspaceB.workspaceId, 'AGENT', {
      name: 'Bilal Ahmed',
    });

    await expect(
      assignContact(
        workspaceA.context,
        { contactId: contactInA.id, assignedToMemberId: outsider.membershipId },
        REQUEST_META,
      ),
    ).rejects.toThrow(NotFoundError);

    const untouched = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(untouched.assignedToMemberId).toBeNull();
  });

  it('accepts a member of the same workspace', async () => {
    const colleague = await createMemberFixture(workspaceA.workspaceId, 'AGENT', {
      name: 'Ayesha Khan',
    });

    await assignContact(
      workspaceA.context,
      { contactId: contactInA.id, assignedToMemberId: colleague.membershipId },
      REQUEST_META,
    );

    // `assignContact` returns void, so the assertion goes to the database rather than
    // to a return value — which is the stronger check anyway: it is the stored column
    // the next reader sees, not what the service claimed to have done.
    const assigned = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(assigned.assignedToMemberId).toBe(colleague.membershipId);

    const detail = await getContact(workspaceA.context, contactInA.id);
    expect(detail.contact.assignedToName).toBe('Ayesha Khan');
  });

  /**
   * A suspended colleague cannot open the conversation, so assigning a customer to
   * them parks that customer in a queue nobody is watching. This is a product rule
   * rather than a security one, but it fails in the same place and is cheap to hold.
   */
  it('refuses a suspended member of the same workspace', async () => {
    const suspended = await createMemberFixture(workspaceA.workspaceId, 'AGENT', {
      name: 'Usman Tariq',
      status: 'SUSPENDED',
    });

    await expect(
      assignContact(
        workspaceA.context,
        { contactId: contactInA.id, assignedToMemberId: suspended.membershipId },
        REQUEST_META,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe('role authorization on a customer', () => {
  /**
   * Instruction #100, server-side. Hiding the removal control is not the control; an
   * agent posting the form directly must still be refused, and refused with 403 rather
   * than 404, because here the record genuinely is theirs to see.
   */
  it('stops an agent removing a customer', async () => {
    const agent = await createMemberFixture(workspaceA.workspaceId, 'AGENT');
    const agentContext = tenantContextFor({
      workspaceId: workspaceA.workspaceId,
      workspaceSlug: workspaceA.workspaceSlug,
      workspaceName: 'Akmal Fashion',
      currency: 'PKR',
      userId: agent.userId,
      userName: agent.name,
      userEmail: agent.email,
      membershipId: agent.membershipId,
      role: 'AGENT',
    });

    await expect(
      deleteContact(agentContext, contactInA.id, REQUEST_META),
    ).rejects.toThrow(ForbiddenError);

    const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: contactInA.id } });
    expect(survivor.deletedAt).toBeNull();
  });

  it('lets an agent read and edit the same customer', async () => {
    const agent = await createMemberFixture(workspaceA.workspaceId, 'AGENT');
    const agentContext = tenantContextFor({
      workspaceId: workspaceA.workspaceId,
      workspaceSlug: workspaceA.workspaceSlug,
      workspaceName: 'Akmal Fashion',
      currency: 'PKR',
      userId: agent.userId,
      userName: agent.name,
      userEmail: agent.email,
      membershipId: agent.membershipId,
      role: 'AGENT',
    });

    const detail = await getContact(agentContext, contactInA.id);
    expect(detail.can).toEqual({
      update: true,
      delete: false,
      assign: true,
      addNote: true,
    });
  });

  it('stops a viewer writing a note', async () => {
    const viewer = await createMemberFixture(workspaceA.workspaceId, 'VIEWER');
    const viewerContext = tenantContextFor({
      workspaceId: workspaceA.workspaceId,
      workspaceSlug: workspaceA.workspaceSlug,
      workspaceName: 'Akmal Fashion',
      currency: 'PKR',
      userId: viewer.userId,
      userName: viewer.name,
      userEmail: viewer.email,
      membershipId: viewer.membershipId,
      role: 'VIEWER',
    });

    await expect(
      addContactNote(
        viewerContext,
        { contactId: contactInA.id, body: 'Should not be saved.' },
        REQUEST_META,
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('the happy path, for contrast', () => {
  it('creates, edits, notes and removes a customer inside one workspace', async () => {
    const created = await prisma.contact.create({
      data: { workspaceId: workspaceA.workspaceId, phoneE164: '+923001112233', name: 'Hira Nadeem' },
    });

    const edited = await updateContact(
      workspaceA.context,
      {
        contactId: created.id,
        name: 'Hira Nadeem',
        email: 'hira@example.test',
        source: 'Instagram',
        language: 'Roman Urdu',
        city: 'Lahore',
        addressLine1: 'House 12, Street 4',
        addressLine2: null,
        postalCode: '54000',
      },
      REQUEST_META,
    );
    expect(edited.city).toBe('Lahore');
    expect(edited.email).toBe('hira@example.test');

    await addContactNote(
      workspaceA.context,
      { contactId: created.id, body: 'Wants the navy kurta in L — will confirm after payday.' },
      REQUEST_META,
    );

    const detail = await getContact(workspaceA.context, created.id);
    expect(detail.notes).toHaveLength(1);
    expect(detail.notes[0]?.authorName).toBe('Ahmed Raza');

    await deleteContact(workspaceA.context, created.id, REQUEST_META);

    // Soft delete: the row survives so orders and conversations keep resolving, but
    // the customer leaves the list.
    const removed = await prisma.contact.findUniqueOrThrow({ where: { id: created.id } });
    expect(removed.deletedAt).not.toBeNull();

    const page = await getContacts(workspaceA.context, {
      search: null,
      assignedTo: null,
      cursor: undefined,
      limit: 25,
    });
    expect(page.contacts.map((contact) => contact.id)).not.toContain(created.id);
  });
});
