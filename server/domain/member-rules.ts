/**
 * Team-membership rules.
 *
 * Pure decisions, separated from the service so that every branch is testable
 * without a database. The service supplies the facts — who is acting, who is being
 * acted on, how many owners the workspace has, how many seats the plan allows —
 * and this decides.
 *
 * `server/authz/permissions.ts` answers "does this role hold this capability".
 * These are the rules that a capability check cannot express, because they depend
 * on the *state* of the workspace rather than on the actor's role alone. Both
 * layers run; neither is sufficient.
 *
 * Every function returns a reason string on refusal rather than a bare false. The
 * reason is shown to the person, so it is written for a shop owner: "A business
 * must always have at least one owner", not "OWNER_CARDINALITY_VIOLATION".
 */

import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  canRemoveMember,
  outranks,
  roleHasPermission,
  type WorkspaceRole,
} from '@/server/authz/permissions';

export type RuleResult = { allowed: true } | { allowed: false; reason: string };

const ALLOWED: RuleResult = { allowed: true };
const deny = (reason: string): RuleResult => ({ allowed: false, reason });

export type ActorFacts = {
  readonly role: WorkspaceRole;
  readonly membershipId: string;
};

export type TargetFacts = {
  readonly role: WorkspaceRole;
  readonly membershipId: string;
};

/**
 * Whether `actor` may change `target`'s role to `nextRole`.
 *
 * Four distinct refusals, in the order they matter:
 *
 * Editing your own role is refused outright. An ADMIN may legitimately edit roles,
 * and `canAssignRole` stops them naming a role at or above their own — but nothing
 * stops them *lowering* themselves and then being unable to undo it, and more
 * importantly self-edit is the shape every privilege-escalation attempt takes, so
 * closing it entirely is cheaper than reasoning about each variant.
 *
 * An OWNER's role is never edited in place, and OWNER is never granted by an edit.
 * Ownership moves through the transfer operation, which is separately permissioned
 * and separately audited, so that "who owns this business" has exactly one code
 * path that can change it.
 *
 * Then the last-owner rule, which is about the business rather than about security:
 * a workspace with no owner has nobody who can pay for it or close it.
 *
 * Both halves of the rank comparison are checked: the actor must outrank the role
 * the target *currently* holds, and the role they are being moved *to*. Checking
 * only the destination left a two-step bypass — an ADMIN could not remove a peer
 * ADMIN, but could demote them to MANAGER and remove them on the second click.
 */
export function canChangeRole(
  actor: ActorFacts,
  target: TargetFacts,
  nextRole: WorkspaceRole,
  facts: { activeOwnerCount: number },
): RuleResult {
  if (!roleHasPermission(actor.role, 'member:update_role')) {
    return deny('Your role cannot change team member roles.');
  }

  if (actor.membershipId === target.membershipId) {
    return deny('You cannot change your own role. Ask another owner or admin to do it.');
  }

  if (nextRole === 'OWNER') {
    return deny('Ownership is transferred separately, not set as a role. Use “Transfer ownership”.');
  }

  if (target.role === 'OWNER') {
    if (facts.activeOwnerCount <= 1) {
      return deny('A business must always have at least one owner.');
    }
    return deny('An owner’s role cannot be changed here. Transfer ownership first.');
  }

  if (!outranks(actor.role, target.role)) {
    return deny('You cannot change the role of someone at or above your own.');
  }

  if (target.role === nextRole) {
    return deny('That is already their role.');
  }

  if (!canAssignRole(actor.role, nextRole)) {
    return deny('You cannot give someone a role at or above your own.');
  }

  return ALLOWED;
}

/**
 * Whether `actor` may remove `target` from the workspace.
 *
 * Removing yourself is refused because it is a different operation with different
 * consequences — leaving is voluntary, being removed is not, and conflating them
 * means an owner can accidentally lock themselves out with a misclick on a row
 * that looks like everyone else's.
 */
export function canRemove(actor: ActorFacts, target: TargetFacts): RuleResult {
  if (!roleHasPermission(actor.role, 'member:remove')) {
    return deny('Your role cannot remove team members.');
  }

  if (actor.membershipId === target.membershipId) {
    return deny('You cannot remove yourself. Use “Leave business” instead.');
  }

  if (target.role === 'OWNER') {
    return deny('An owner cannot be removed. Transfer ownership first.');
  }

  if (!canRemoveMember(actor.role, target.role)) {
    return deny('You cannot remove someone at or above your own role.');
  }

  return ALLOWED;
}

/**
 * Whether `actor` may hand ownership to `target`.
 *
 * Only an OWNER may, and only to an existing active member. Inviting and promoting
 * in one step would mean an email typo could hand the business to a stranger, so
 * the recipient must already be someone the owner deliberately added.
 */
export function canTransferOwnership(
  actor: ActorFacts,
  target: TargetFacts & { status: 'ACTIVE' | 'SUSPENDED' },
): RuleResult {
  if (!roleHasPermission(actor.role, 'workspace:transfer_ownership')) {
    return deny('Only the owner can transfer ownership.');
  }

  if (actor.membershipId === target.membershipId) {
    return deny('You already own this business.');
  }

  if (target.status !== 'ACTIVE') {
    return deny('That member is suspended. Reactivate them before transferring ownership.');
  }

  return ALLOWED;
}

/**
 * Whether `actor` may leave the workspace of their own accord.
 *
 * The last owner cannot leave. The alternative — an ownerless workspace holding a
 * live WhatsApp connection and a customer database — is worse than the mild
 * annoyance of having to transfer or delete first.
 */
export function canLeave(actor: ActorFacts, facts: { activeOwnerCount: number }): RuleResult {
  if (actor.role === 'OWNER' && facts.activeOwnerCount <= 1) {
    return deny(
      'You are the only owner. Transfer ownership to someone else, or delete the business, before leaving.',
    );
  }
  return ALLOWED;
}

/**
 * What the caller may do to one particular member.
 *
 * A `true` here is a statement about what the server will accept, not a hint: each
 * flag is the same rule function the corresponding mutation enforces, asked in
 * advance. The UI renders controls from these booleans and therefore holds no copy
 * of the rules that could drift out of step.
 */
export type MemberCapabilities = {
  readonly changeRole: boolean;
  readonly suspend: boolean;
  readonly remove: boolean;
  readonly transferOwnership: boolean;
};

/**
 * Everything the caller may do to one member, asked of the rules rather than
 * inferred from roles a second time.
 *
 * `assignableRoles` is built by putting each candidate role to `canChangeRole`, so a
 * change to that rule reaches the UI with no second edit — and `changeRole` is then
 * simply whether that list came back non-empty, which is the only definition that
 * cannot disagree with the select the UI would render.
 */
export function capabilitiesFor(
  actor: ActorFacts,
  target: TargetFacts & { status: 'ACTIVE' | 'SUSPENDED' },
  facts: { activeOwnerCount: number },
): { can: MemberCapabilities; assignableRoles: WorkspaceRole[] } {
  const assignableRoles = ASSIGNABLE_ROLES.filter(
    (role) => canChangeRole(actor, target, role, facts).allowed,
  );

  // Suspension is reversible removal, so it rides on the same permission and the
  // same "not above your own role" rule.
  const removable = canRemove(actor, target).allowed;

  return {
    can: {
      changeRole: assignableRoles.length > 0,
      suspend: removable,
      remove: removable,
      transferOwnership: canTransferOwnership(actor, target).allowed,
    },
    assignableRoles: [...assignableRoles],
  };
}

/**
 * Whether another person can be added under the plan's seat limit.
 *
 * Pending invites count against the limit. If they did not, a workspace on a
 * three-seat plan could issue thirty invites and end up with thirty members, and
 * the limit would be enforced only by whoever happened to accept last — which is
 * to say, not enforced.
 *
 * `maxSeats` of null means unlimited, which is how the higher plans are expressed.
 */
export function canAddSeat(facts: {
  memberCount: number;
  pendingInviteCount: number;
  maxSeats: number | null;
}): RuleResult {
  if (facts.maxSeats === null) return ALLOWED;

  const used = facts.memberCount + facts.pendingInviteCount;
  if (used >= facts.maxSeats) {
    return deny(
      `Your plan includes ${facts.maxSeats} team ${facts.maxSeats === 1 ? 'member' : 'members'}. ` +
        `Upgrade your plan to invite more.`,
    );
  }
  return ALLOWED;
}

export type InviteState = 'valid' | 'expired' | 'accepted' | 'revoked';

/**
 * Classifies an invite before it is acted on.
 *
 * Order matters: a revoked invite that has also expired reports as revoked,
 * because revocation is the deliberate act and is what the person needs to hear.
 */
export function classifyInvite(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
): InviteState {
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.acceptedAt !== null) return 'accepted';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/** Written for the person holding a link that no longer works. */
export const INVITE_STATE_MESSAGES: Record<Exclude<InviteState, 'valid'>, string> = {
  expired: 'This invitation has expired. Ask the business owner to send a new one.',
  accepted: 'This invitation has already been used.',
  revoked: 'This invitation is no longer valid.',
};

/**
 * Whether the signed-in account may accept an invite.
 *
 * The invited address must match the account's own. An invite is addressed to a
 * person, and a forwarded link should not let whoever received it join instead —
 * the token proves the link was delivered, not who is holding it.
 */
export function canAcceptInvite(inviteEmail: string, accountEmail: string): RuleResult {
  const invited = inviteEmail.trim().toLowerCase();
  const account = accountEmail.trim().toLowerCase();

  if (invited !== account) {
    return deny(`This invitation was sent to ${inviteEmail}. Sign in with that account to accept it.`);
  }
  return ALLOWED;
}
