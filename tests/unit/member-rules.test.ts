/**
 * Team-membership rule tests.
 *
 * These are the rules that decide who can change whose role and who can be removed,
 * which makes them the rules an attacker inside a workspace would probe first. The
 * interesting cases are not the happy paths — they are the four ways an ADMIN could
 * try to become an OWNER, and the two ways a business could end up with no owner at
 * all.
 *
 * Pure module, so every branch is reachable without a database.
 */

import { describe, expect, it } from 'vitest';

import {
  canAcceptInvite,
  canAddSeat,
  canChangeRole,
  canLeave,
  canRemove,
  canTransferOwnership,
  capabilitiesFor,
  classifyInvite,
  INVITE_STATE_MESSAGES,
  type ActorFacts,
  type TargetFacts,
} from '@/server/domain/member-rules';
import {
  ASSIGNABLE_ROLES,
  outranks,
  ROLE_DISPLAY_ORDER,
  type WorkspaceRole,
} from '@/server/authz/permissions';

const actor = (role: WorkspaceRole, id = 'actor-1'): ActorFacts => ({ role, membershipId: id });
const target = (role: WorkspaceRole, id = 'target-1'): TargetFacts => ({ role, membershipId: id });

const twoOwners = { activeOwnerCount: 2 };
const oneOwner = { activeOwnerCount: 1 };

describe('canChangeRole', () => {
  it('lets an owner promote an agent to manager', () => {
    const result = canChangeRole(actor('OWNER'), target('AGENT'), 'MANAGER', oneOwner);
    expect(result.allowed).toBe(true);
  });

  it('lets an admin promote an agent to manager', () => {
    expect(canChangeRole(actor('ADMIN'), target('AGENT'), 'MANAGER', oneOwner).allowed).toBe(true);
  });

  it('refuses a manager, who holds no role-editing permission', () => {
    const result = canChangeRole(actor('MANAGER'), target('AGENT'), 'VIEWER', oneOwner);
    expect(result.allowed).toBe(false);
  });

  it('refuses an agent outright — brief §100', () => {
    expect(canChangeRole(actor('AGENT'), target('VIEWER'), 'MANAGER', oneOwner).allowed).toBe(false);
  });

  it('refuses a viewer', () => {
    expect(canChangeRole(actor('VIEWER'), target('AGENT'), 'MANAGER', oneOwner).allowed).toBe(false);
  });

  // The escalation attempts. Each is a distinct route to the same prize.

  it('refuses editing your own role, even as owner', () => {
    const self = actor('OWNER', 'same-id');
    const result = canChangeRole(self, target('OWNER', 'same-id'), 'ADMIN', twoOwners);
    expect(result).toEqual({
      allowed: false,
      reason: 'You cannot change your own role. Ask another owner or admin to do it.',
    });
  });

  it('refuses an admin promoting themselves', () => {
    const self = actor('ADMIN', 'admin-1');
    expect(canChangeRole(self, target('ADMIN', 'admin-1'), 'OWNER', oneOwner).allowed).toBe(false);
  });

  it('refuses granting OWNER as a role edit, whoever asks', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const result = canChangeRole(actor(role), target('MANAGER'), 'OWNER', twoOwners);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('Transfer ownership');
    }
  });

  it('refuses an admin assigning ADMIN — at their own level, not below it', () => {
    expect(canChangeRole(actor('ADMIN'), target('MANAGER'), 'ADMIN', oneOwner).allowed).toBe(false);
  });

  it('refuses an admin editing an owner', () => {
    expect(canChangeRole(actor('ADMIN'), target('OWNER'), 'VIEWER', twoOwners).allowed).toBe(false);
  });

  it('refuses demoting the last owner, and says why', () => {
    const result = canChangeRole(actor('OWNER', 'a'), target('OWNER', 'b'), 'ADMIN', oneOwner);
    expect(result).toEqual({
      allowed: false,
      reason: 'A business must always have at least one owner.',
    });
  });

  it('still refuses demoting a co-owner in place when there are two', () => {
    // Not a cardinality problem — ownership changes through transfer only, so that
    // "who owns this business" has one auditable code path.
    const result = canChangeRole(actor('OWNER', 'a'), target('OWNER', 'b'), 'ADMIN', twoOwners);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('Transfer ownership first');
  });

  it('refuses a no-op edit rather than writing an audit entry for nothing', () => {
    expect(canChangeRole(actor('OWNER'), target('MANAGER'), 'MANAGER', oneOwner).allowed).toBe(false);
  });

  it('allows an owner to set every non-owner role', () => {
    for (const role of ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const) {
      expect(canChangeRole(actor('OWNER'), target('VIEWER', 't2'), role, oneOwner).allowed).toBe(
        role !== 'VIEWER',
      );
    }
  });

  it('refuses to demote a peer, closing the demote-then-remove bypass', () => {
    // This was a real hole. `canRemove` stops an ADMIN removing a peer ADMIN, but the
    // role edit only checked the destination role — so demoting the peer to MANAGER
    // and removing them on the second click achieved what one click could not.
    for (const role of ['MANAGER', 'AGENT', 'VIEWER'] as const) {
      const result = canChangeRole(actor('ADMIN', 'me'), target('ADMIN', 'peer'), role, twoOwners);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('at or above your own');
    }
  });

  it('refuses to edit anyone the actor does not outrank, for every pairing', () => {
    // The invariant behind the bypass above, stated once so it cannot regress for a
    // pairing nobody thought to write a case for.
    for (const actorRole of ROLE_DISPLAY_ORDER) {
      for (const targetRole of ROLE_DISPLAY_ORDER) {
        if (outranks(actorRole, targetRole)) continue;
        for (const nextRole of ASSIGNABLE_ROLES) {
          const result = canChangeRole(
            actor(actorRole, 'me'),
            target(targetRole, 'them'),
            nextRole,
            twoOwners,
          );
          expect(result.allowed).toBe(false);
        }
      }
    }
  });
});

describe('canRemove', () => {
  it('lets an owner remove a manager', () => {
    expect(canRemove(actor('OWNER'), target('MANAGER')).allowed).toBe(true);
  });

  it('lets an admin remove an agent', () => {
    expect(canRemove(actor('ADMIN'), target('AGENT')).allowed).toBe(true);
  });

  it('refuses a manager', () => {
    expect(canRemove(actor('MANAGER'), target('AGENT')).allowed).toBe(false);
  });

  it('refuses an agent — brief §100', () => {
    expect(canRemove(actor('AGENT'), target('VIEWER')).allowed).toBe(false);
  });

  it('refuses removing an owner, whoever asks', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const result = canRemove(actor(role, 'a'), target('OWNER', 'b'));
      expect(result.allowed).toBe(false);
    }
  });

  it('refuses removing yourself, and points at leaving instead', () => {
    const result = canRemove(actor('ADMIN', 'same'), target('ADMIN', 'same'));
    expect(result).toEqual({
      allowed: false,
      reason: 'You cannot remove yourself. Use “Leave business” instead.',
    });
  });

  it('refuses an admin removing another admin', () => {
    expect(canRemove(actor('ADMIN', 'a'), target('ADMIN', 'b')).allowed).toBe(false);
  });
});

describe('canTransferOwnership', () => {
  const activeTarget = { ...target('ADMIN'), status: 'ACTIVE' as const };

  it('lets an owner hand over to an active member', () => {
    expect(canTransferOwnership(actor('OWNER'), activeTarget).allowed).toBe(true);
  });

  it('refuses everyone who is not an owner', () => {
    for (const role of ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const) {
      const result = canTransferOwnership(actor(role), activeTarget);
      expect(result).toEqual({ allowed: false, reason: 'Only the owner can transfer ownership.' });
    }
  });

  it('refuses transferring to yourself', () => {
    const self = { ...target('OWNER', 'same'), status: 'ACTIVE' as const };
    expect(canTransferOwnership(actor('OWNER', 'same'), self).allowed).toBe(false);
  });

  it('refuses transferring to a suspended member', () => {
    const suspended = { ...target('ADMIN'), status: 'SUSPENDED' as const };
    const result = canTransferOwnership(actor('OWNER'), suspended);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('suspended');
  });
});

describe('canLeave', () => {
  it('lets a non-owner leave', () => {
    for (const role of ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const) {
      expect(canLeave(actor(role), oneOwner).allowed).toBe(true);
    }
  });

  it('lets an owner leave when another owner remains', () => {
    expect(canLeave(actor('OWNER'), twoOwners).allowed).toBe(true);
  });

  it('refuses the only owner', () => {
    const result = canLeave(actor('OWNER'), oneOwner);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('only owner');
  });
});

describe('canAddSeat', () => {
  it('allows any count when the plan is unlimited', () => {
    expect(canAddSeat({ memberCount: 400, pendingInviteCount: 20, maxSeats: null }).allowed).toBe(
      true,
    );
  });

  it('allows a seat below the limit', () => {
    expect(canAddSeat({ memberCount: 2, pendingInviteCount: 0, maxSeats: 3 }).allowed).toBe(true);
  });

  it('refuses at the limit', () => {
    expect(canAddSeat({ memberCount: 3, pendingInviteCount: 0, maxSeats: 3 }).allowed).toBe(false);
  });

  it('counts pending invites against the limit', () => {
    // Without this, thirty invites on a three-seat plan produce thirty members.
    const result = canAddSeat({ memberCount: 1, pendingInviteCount: 2, maxSeats: 3 });
    expect(result.allowed).toBe(false);
  });

  it('names the limit and singularises correctly', () => {
    const one = canAddSeat({ memberCount: 1, pendingInviteCount: 0, maxSeats: 1 });
    if (!one.allowed) expect(one.reason).toContain('1 team member');

    const many = canAddSeat({ memberCount: 5, pendingInviteCount: 0, maxSeats: 5 });
    if (!many.allowed) expect(many.reason).toContain('5 team members');
  });
});

describe('classifyInvite', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const future = new Date('2026-08-30T12:00:00.000Z');
  const past = new Date('2026-08-20T12:00:00.000Z');

  it('calls a fresh unused invite valid', () => {
    expect(classifyInvite({ expiresAt: future, acceptedAt: null, revokedAt: null }, now)).toBe(
      'valid',
    );
  });

  it('calls a past-expiry invite expired', () => {
    expect(classifyInvite({ expiresAt: past, acceptedAt: null, revokedAt: null }, now)).toBe(
      'expired',
    );
  });

  it('treats the expiry instant itself as expired', () => {
    expect(classifyInvite({ expiresAt: now, acceptedAt: null, revokedAt: null }, now)).toBe(
      'expired',
    );
  });

  it('calls a used invite accepted', () => {
    expect(classifyInvite({ expiresAt: future, acceptedAt: past, revokedAt: null }, now)).toBe(
      'accepted',
    );
  });

  it('reports revocation ahead of expiry, because it is the deliberate act', () => {
    expect(classifyInvite({ expiresAt: past, acceptedAt: null, revokedAt: past }, now)).toBe(
      'revoked',
    );
  });

  it('reports revocation ahead of acceptance', () => {
    expect(classifyInvite({ expiresAt: future, acceptedAt: past, revokedAt: past }, now)).toBe(
      'revoked',
    );
  });

  it('has a message for every non-valid state', () => {
    for (const state of ['expired', 'accepted', 'revoked'] as const) {
      expect(INVITE_STATE_MESSAGES[state].length).toBeGreaterThan(0);
    }
  });
});

describe('canAcceptInvite', () => {
  it('accepts an exact match', () => {
    expect(canAcceptInvite('ahmed@akmalfashion.pk', 'ahmed@akmalfashion.pk').allowed).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(canAcceptInvite('Ahmed@AkmalFashion.pk', '  ahmed@akmalfashion.pk ').allowed).toBe(true);
  });

  it('refuses a forwarded link opened by someone else', () => {
    const result = canAcceptInvite('ahmed@akmalfashion.pk', 'someone.else@example.com');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('ahmed@akmalfashion.pk');
  });

  it('does not treat a subaddress as the same account', () => {
    // "user+tag@" is the same mailbox at most providers, but treating them as equal
    // would let anyone who can guess the invited address mint a matching alias.
    expect(canAcceptInvite('ahmed@akmalfashion.pk', 'ahmed+os@akmalfashion.pk').allowed).toBe(false);
  });
});

/**
 * `capabilitiesFor` is what the team page renders its controls from, so a bug here
 * shows up as a button that promises something the server will refuse — or worse, a
 * missing button hiding something the server would have allowed.
 *
 * The property that matters is agreement: every flag must equal the rule the
 * corresponding mutation enforces, for every actor/target pairing. So rather than
 * assert a handful of expected booleans, most of these tests cross-check the two.
 */
describe('capabilitiesFor', () => {
  const active = (role: WorkspaceRole, id = 'target-1') => ({ ...target(role, id), status: 'ACTIVE' as const });
  const suspended = (role: WorkspaceRole, id = 'target-1') => ({
    ...target(role, id),
    status: 'SUSPENDED' as const,
  });

  it('agrees with the underlying rules for every actor and target pairing', () => {
    for (const actorRole of ROLE_DISPLAY_ORDER) {
      for (const targetRole of ROLE_DISPLAY_ORDER) {
        for (const facts of [oneOwner, twoOwners]) {
          const a = actor(actorRole);
          const t = active(targetRole);
          const { can, assignableRoles } = capabilitiesFor(a, t, facts);

          expect(can.remove).toBe(canRemove(a, t).allowed);
          expect(can.suspend).toBe(canRemove(a, t).allowed);
          expect(can.transferOwnership).toBe(canTransferOwnership(a, t).allowed);

          for (const role of ASSIGNABLE_ROLES) {
            const allowed = canChangeRole(a, t, role, facts).allowed;
            expect(assignableRoles.includes(role)).toBe(allowed);
          }
          expect(can.changeRole).toBe(assignableRoles.length > 0);
        }
      }
    }
  });

  it('never offers OWNER as an assignable role', () => {
    for (const actorRole of ROLE_DISPLAY_ORDER) {
      const { assignableRoles } = capabilitiesFor(actor(actorRole), active('AGENT'), twoOwners);
      expect(assignableRoles).not.toContain('OWNER');
    }
  });

  it('offers an owner every role except the one the member already holds', () => {
    const { can, assignableRoles } = capabilitiesFor(actor('OWNER'), active('AGENT'), oneOwner);
    expect(can.changeRole).toBe(true);
    expect(assignableRoles).toEqual(['ADMIN', 'MANAGER', 'VIEWER']);
  });

  it('does not let an admin touch another admin or the owner', () => {
    const peer = capabilitiesFor(actor('ADMIN'), active('ADMIN', 'other-admin'), twoOwners);
    expect(peer.can).toEqual({
      changeRole: false,
      suspend: false,
      remove: false,
      transferOwnership: false,
    });

    const owner = capabilitiesFor(actor('ADMIN'), active('OWNER', 'the-owner'), twoOwners);
    expect(owner.can.changeRole).toBe(false);
    expect(owner.can.remove).toBe(false);
    expect(owner.can.transferOwnership).toBe(false);
  });

  it('gives a manager, agent and viewer no controls at all', () => {
    for (const role of ['MANAGER', 'AGENT', 'VIEWER'] as const) {
      const { can, assignableRoles } = capabilitiesFor(actor(role), active('AGENT', 'someone'), twoOwners);
      expect(assignableRoles).toEqual([]);
      expect(Object.values(can).some(Boolean)).toBe(false);
    }
  });

  it('withholds every control on the caller’s own row', () => {
    // Self-service is the shape a privilege escalation takes, so the row that
    // represents you offers nothing — leaving is a separate, deliberate action.
    const me = actor('OWNER', 'me');
    const { can, assignableRoles } = capabilitiesFor(
      me,
      { role: 'OWNER', membershipId: 'me', status: 'ACTIVE' },
      twoOwners,
    );
    expect(assignableRoles).toEqual([]);
    expect(can).toEqual({
      changeRole: false,
      suspend: false,
      remove: false,
      transferOwnership: false,
    });
  });

  it('will not transfer ownership to a suspended member but will still remove them', () => {
    const result = capabilitiesFor(actor('OWNER'), suspended('MANAGER'), oneOwner);
    expect(result.can.transferOwnership).toBe(false);
    expect(result.can.remove).toBe(true);
    expect(result.can.suspend).toBe(true);
  });

  it('returns a fresh array the caller cannot use to mutate the shared role list', () => {
    const first = capabilitiesFor(actor('OWNER'), active('AGENT'), twoOwners).assignableRoles;
    first.push('OWNER');
    const second = capabilitiesFor(actor('OWNER'), active('AGENT'), twoOwners).assignableRoles;
    expect(second).not.toContain('OWNER');
    expect(ASSIGNABLE_ROLES).not.toContain('OWNER');
  });
});
