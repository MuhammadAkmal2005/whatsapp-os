import { describe, expect, it } from 'vitest';

import type { WorkspaceRole } from '@/server/authz/permissions';
import {
  contactCapability,
  contactDetailCapability,
  contactListCapability,
} from '@/server/services/contact/contact.capability';
import type { TenantContext } from '@/server/tenancy/context';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';

function contextFor(role: WorkspaceRole): TenantContext {
  return {
    user: {
      id: 'user-1',
      email: 'ahmed@akmalfashion.example',
      name: 'Ahmed Raza',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      avatarUrl: null,
    },
    workspaceId: WORKSPACE_A,
    workspaceSlug: 'akmal-fashion',
    workspaceName: 'Akmal Fashion',
    role,
    membershipId: 'membership-1',
    sessionId: 'session-1',
    currency: 'PKR',
    planKey: 'business',
    requestId: 'request-1',
  };
}

const ALL_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;

/**
 * Instruction #100. The flags below are what the customer pages use to decide whether
 * to draw a control. They are not the enforcement — every mutating service function
 * calls `requirePermission` regardless — but a flag that says yes where the service
 * says no produces a button that fails, and a flag that says no where the service says
 * yes hides a feature someone is paying for. Both are worth a test.
 */
describe('what each role may do to a customer', () => {
  it('lets an owner do everything', () => {
    const capability = contactDetailCapability(contextFor('OWNER'));
    expect(capability).toEqual({ update: true, delete: true, assign: true, addNote: true });
    expect(contactListCapability(contextFor('OWNER'))).toEqual({ create: true, export: true });
  });

  it('lets a manager run the customer book, including removal and export', () => {
    expect(contactDetailCapability(contextFor('MANAGER'))).toEqual({
      update: true,
      delete: true,
      assign: true,
      addNote: true,
    });
    expect(contactListCapability(contextFor('MANAGER'))).toEqual({ create: true, export: true });
  });

  /**
   * The interesting row. An agent works customers all day — they add them, correct a
   * misspelt name, hand one to a colleague, write a note — but they cannot remove a
   * customer and they cannot export the book. Removal is recoverable only from the
   * database, and an export is the whole customer list leaving the building on a
   * departing employee's laptop.
   */
  it('lets an agent work customers but not remove or export them', () => {
    expect(contactDetailCapability(contextFor('AGENT'))).toEqual({
      update: true,
      delete: false,
      assign: true,
      addNote: true,
    });
    expect(contactListCapability(contextFor('AGENT'))).toEqual({ create: true, export: false });
  });

  it('gives a viewer nothing but the read they already had', () => {
    expect(contactDetailCapability(contextFor('VIEWER'))).toEqual({
      update: false,
      delete: false,
      assign: false,
      addNote: false,
    });
    expect(contactListCapability(contextFor('VIEWER'))).toEqual({ create: false, export: false });
  });
});

describe('the shape of the capability itself', () => {
  /**
   * `assign` is derived from `contact:update` rather than being a permission of its
   * own, and the two must not drift apart while that is true. If a later plan splits
   * them, this is the test that should be changed on purpose — which is the point of
   * asserting an identity that currently looks tautological.
   */
  it('ties assignment to update for every role', () => {
    for (const role of ALL_ROLES) {
      const capability = contactCapability(contextFor(role));
      expect(capability.assign).toBe(capability.update);
    }
  });

  it('ties adding a note to update for every role', () => {
    for (const role of ALL_ROLES) {
      const capability = contactDetailCapability(contextFor(role));
      expect(capability.addNote).toBe(capability.update);
    }
  });

  /**
   * Removal is never granted more widely than editing. A role that can delete a
   * customer but not correct their phone number would be an odd permission set, and
   * far more likely a typo in the role table than a decision.
   */
  it('never grants removal to a role that cannot edit', () => {
    for (const role of ALL_ROLES) {
      const capability = contactCapability(contextFor(role));
      if (capability.delete) expect(capability.update).toBe(true);
    }
  });

  it('never grants export to a role that cannot read', () => {
    // Every role in the table holds `contact:read`; this asserts the weakest of them
    // still cannot export, which is the property that actually matters.
    expect(contactListCapability(contextFor('VIEWER')).export).toBe(false);
  });

  /**
   * Capability answers are a question, not an assertion: they must never throw. The
   * pages call them while rendering, and a throw here would turn a permission question
   * into an error boundary on a page the person is allowed to see.
   */
  it('answers for every role without throwing', () => {
    for (const role of ALL_ROLES) {
      expect(() => contactCapability(contextFor(role))).not.toThrow();
      expect(() => contactListCapability(contextFor(role))).not.toThrow();
      expect(() => contactDetailCapability(contextFor(role))).not.toThrow();
    }
  });
});
