/**
 * Team management service.
 *
 * Where the authorization for team changes actually happens. Three layers run on
 * every mutation and each catches something the others cannot:
 *
 *   1. `requirePermission` — does this role hold this capability at all.
 *   2. `member-rules` — do the workspace's current facts allow it (last owner,
 *      self-targeting, seat limit).
 *   3. The repository's scoped write — did it touch a row in *this* workspace,
 *      reported as a row count that a zero turns into NotFound.
 *
 * The third layer is the one that matters if the first two are ever bypassed by a
 * new entry point, because it is enforced in the `where` clause rather than in a
 * branch someone can forget to write.
 *
 * On invitations: there is no email provider configured yet, so this does not
 * pretend to send one. `inviteMember` returns a single-use link for the owner to
 * pass on — which is what a Pakistani shop owner does anyway, over WhatsApp. When
 * the email provider lands, delivery becomes an additional channel for the same
 * token, not a replacement for this flow.
 */

import 'server-only';

import { env } from '@/config/env';
import { getPlan } from '@/config/plans';
import { prisma } from '@/db/prisma';
import { sha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { expiryFrom, generateSingleUseToken, INVITE_TTL_MS } from '@/server/auth/session-token';
import { ASSIGNABLE_ROLES, canAssignRole, type WorkspaceRole } from '@/server/authz/permissions';
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
  type MemberCapabilities,
  type RuleResult,
} from '@/server/domain/member-rules';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from '@/server/errors';
import { appendAuditLog, appendProductEvent } from '@/server/repositories/audit.repository';
import {
  countMembers,
  countOwners,
  countPendingInvites,
  createMember,
  deleteMember,
  findInviteByTokenHash,
  findMemberById,
  findMemberByUserId,
  listMembers,
  listPendingInvites,
  markInviteAccepted,
  revokeInvite as revokeInviteRow,
  updateMemberRole,
  updateMemberStatus,
  upsertInvite,
  type InviteRow,
  type MemberRow,
} from '@/server/repositories/member.repository';
import { findUserByEmail } from '@/server/repositories/user.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';

/**
 * Turns a rule refusal into the right error type.
 *
 * `BusinessRuleError` rather than `ForbiddenError` for state-based refusals, because
 * "a business must always have one owner" is not a permission problem and framing it
 * as one sends the person to the wrong place looking for a fix.
 */
function enforce(result: RuleResult): void {
  if (!result.allowed) throw new BusinessRuleError(result.reason);
}

/** A zero row count from a scoped write means the id was not in this workspace.
 *  NotFound, never Forbidden — a 403 would confirm the id exists elsewhere. */
function assertTouched(count: number, what: string): void {
  if (count === 0) throw new NotFoundError(what);
}

/**
 * What the caller may do to one particular member. Re-exported from the domain rules
 * so a UI component can import it from the service it actually calls.
 */
export type { MemberCapabilities };

export type TeamMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED';
  joinedAt: Date;
  lastActiveAt: Date | null;
  isYou: boolean;
  can: MemberCapabilities;
  /** The roles the caller may actually move *this* member to. Derived by asking
   *  `canChangeRole` about each candidate rather than re-deriving the rule. */
  assignableRoles: WorkspaceRole[];
};

export type PendingInvite = {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  invitedByName: string;
  createdAt: Date;
};

export type TeamOverview = {
  members: TeamMember[];
  invites: PendingInvite[];
  seats: { used: number; limit: number | null };
  /** Pre-computed so the UI can disable a control and explain why, without
   *  duplicating any of the rules that the service will enforce regardless. */
  canInvite: RuleResult;
  /** Same idea for the caller's own exit: the last owner cannot leave, and saying
   *  so on the page is kinder than refusing after they click. */
  canLeave: RuleResult;
  /** Roles offered in the invite form, narrowed to what the caller may grant. */
  assignableRoles: WorkspaceRole[];
};

function toTeamMember(
  row: MemberRow,
  actor: ActorFacts,
  facts: { activeOwnerCount: number },
): TeamMember {
  const target = { role: row.role, membershipId: row.id, status: row.status };
  const { can, assignableRoles } = capabilitiesFor(actor, target, facts);

  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
    lastActiveAt: row.lastActiveAt,
    isYou: row.id === actor.membershipId,
    can,
    assignableRoles,
  };
}

function toPendingInvite(row: InviteRow): PendingInvite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    invitedByName: row.invitedBy.name,
    createdAt: row.createdAt,
  };
}

export async function getTeam(ctx: TenantContext): Promise<TeamOverview> {
  requirePermission(ctx, 'member:read');

  const [members, invites] = await Promise.all([
    listMembers(prisma, ctx.workspaceId),
    listPendingInvites(prisma, ctx.workspaceId),
  ]);

  const limit = getPlan(ctx.planKey).limits.teamMembers;
  const now = new Date();
  const pendingCount = invites.filter((invite) => invite.expiresAt > now).length;

  // Counted from the rows already loaded rather than with a second query. The list
  // is the whole membership, so it is the same number `countOwners` would return.
  const activeOwnerCount = members.filter(
    (row) => row.role === 'OWNER' && row.status === 'ACTIVE',
  ).length;

  const actor: ActorFacts = { role: ctx.role, membershipId: ctx.membershipId };
  const facts = { activeOwnerCount };

  return {
    members: members.map((row) => toTeamMember(row, actor, facts)),
    invites: invites.map(toPendingInvite),
    seats: { used: members.length + pendingCount, limit },
    canInvite: canAddSeat({
      memberCount: members.length,
      pendingInviteCount: pendingCount,
      maxSeats: limit,
    }),
    canLeave: canLeave(actor, facts),
    assignableRoles: ASSIGNABLE_ROLES.filter((role) => canAssignRole(ctx.role, role)),
  };
}

export type InviteResult = {
  inviteId: string;
  email: string;
  role: WorkspaceRole;
  /** The single-use link. Returned once; only its hash is stored, so it cannot be
   *  shown again and a fresh invite must be issued instead. */
  inviteUrl: string;
  expiresAt: Date;
};

export async function inviteMember(
  ctx: TenantContext,
  input: { email: string; role: WorkspaceRole },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<InviteResult> {
  requirePermission(ctx, 'member:invite');

  if (input.role === 'OWNER') {
    throw new BusinessRuleError('Ownership is transferred separately, not given as a role.');
  }

  const email = input.email.trim().toLowerCase();

  // Already on the team is a conflict, not an invitation. Silently re-inviting an
  // existing member would produce a link that fails confusingly on acceptance.
  const existingUser = await findUserByEmail(prisma, email);
  if (existingUser) {
    const existingMember = await findMemberByUserId(prisma, ctx.workspaceId, existingUser.id);
    if (existingMember) {
      throw new ConflictError(`${email} is already on your team.`);
    }
  }

  const limit = getPlan(ctx.planKey).limits.teamMembers;
  const [memberCount, pendingInviteCount] = await Promise.all([
    countMembers(prisma, ctx.workspaceId),
    countPendingInvites(prisma, ctx.workspaceId),
  ]);

  const seat = canAddSeat({ memberCount, pendingInviteCount, maxSeats: limit });
  if (!seat.allowed) {
    // Its own error type so the UI offers an upgrade rather than an apology.
    throw new LimitExceededError('teamMembers', limit ?? 0, seat.reason);
  }

  const token = generateSingleUseToken();
  const expiresAt = expiryFrom(INVITE_TTL_MS);

  const invite = await upsertInvite(prisma, {
    workspaceId: ctx.workspaceId,
    email,
    role: input.role,
    tokenHash: sha256(token),
    invitedByUserId: ctx.user.id,
    expiresAt,
  });

  await appendAuditLog(prisma, {
    action: 'member.invited',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceInvite',
    resourceId: invite.id,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    // The email is the subject of the record; the token never is.
    metadata: { email, role: input.role },
  });

  logger.info('team.invite.created', {
    workspaceId: ctx.workspaceId,
    inviteId: invite.id,
    role: input.role,
    requestId: ctx.requestId,
  });

  return {
    inviteId: invite.id,
    email,
    role: input.role,
    inviteUrl: `${env.APP_URL}/invite/${token}`,
    expiresAt,
  };
}

export async function changeMemberRole(
  ctx: TenantContext,
  input: { memberId: string; role: WorkspaceRole },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  requirePermission(ctx, 'member:update_role');

  const target = await findMemberById(prisma, ctx.workspaceId, input.memberId);
  if (!target) throw new NotFoundError('Team member');

  const activeOwnerCount = await countOwners(prisma, ctx.workspaceId);

  enforce(
    canChangeRole(
      { role: ctx.role, membershipId: ctx.membershipId },
      { role: target.role, membershipId: target.id },
      input.role,
      { activeOwnerCount },
    ),
  );

  const previousRole = target.role;
  assertTouched(
    await updateMemberRole(prisma, ctx.workspaceId, target.id, input.role),
    'Team member',
  );

  await appendAuditLog(prisma, {
    action: 'member.role_changed',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceMember',
    resourceId: target.id,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    // Both roles, so the log answers "what changed" without a second lookup.
    metadata: { subjectUserId: target.userId, from: previousRole, to: input.role },
  });
}

export async function setMemberStatus(
  ctx: TenantContext,
  input: { memberId: string; status: 'ACTIVE' | 'SUSPENDED' },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  // Suspension is reversible removal, so it sits under the same permission.
  requirePermission(ctx, 'member:remove');

  const target = await findMemberById(prisma, ctx.workspaceId, input.memberId);
  if (!target) throw new NotFoundError('Team member');

  if (target.id === ctx.membershipId) {
    throw new BusinessRuleError('You cannot suspend your own access.');
  }
  if (target.role === 'OWNER') {
    throw new BusinessRuleError('An owner cannot be suspended. Transfer ownership first.');
  }
  enforce(
    canRemove(
      { role: ctx.role, membershipId: ctx.membershipId },
      { role: target.role, membershipId: target.id },
    ),
  );

  assertTouched(
    await updateMemberStatus(prisma, ctx.workspaceId, target.id, input.status),
    'Team member',
  );

  await appendAuditLog(prisma, {
    action: input.status === 'SUSPENDED' ? 'member.suspended' : 'member.reactivated',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceMember',
    resourceId: target.id,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    metadata: { subjectUserId: target.userId, role: target.role },
  });
}

export async function removeMember(
  ctx: TenantContext,
  input: { memberId: string },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  requirePermission(ctx, 'member:remove');

  const target = await findMemberById(prisma, ctx.workspaceId, input.memberId);
  if (!target) throw new NotFoundError('Team member');

  enforce(
    canRemove(
      { role: ctx.role, membershipId: ctx.membershipId },
      { role: target.role, membershipId: target.id },
    ),
  );

  assertTouched(await deleteMember(prisma, ctx.workspaceId, target.id), 'Team member');

  await appendAuditLog(prisma, {
    action: 'member.removed',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceMember',
    resourceId: target.id,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    // Kept because the membership row is gone — the audit entry is now the only
    // record that this person ever had access.
    metadata: { subjectUserId: target.userId, email: target.user.email, role: target.role },
  });

  logger.info('team.member.removed', {
    workspaceId: ctx.workspaceId,
    memberId: target.id,
    requestId: ctx.requestId,
  });
}

export async function revokeInvite(
  ctx: TenantContext,
  input: { inviteId: string },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  requirePermission(ctx, 'member:invite');

  assertTouched(
    await revokeInviteRow(prisma, ctx.workspaceId, input.inviteId, new Date()),
    'Invitation',
  );

  await appendAuditLog(prisma, {
    action: 'member.invite_revoked',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceInvite',
    resourceId: input.inviteId,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });
}

/**
 * Hands the business to another member.
 *
 * Both writes run in one transaction. A failure between them would leave two
 * owners or none, and "none" means nobody can pay the bill or close the account.
 */
export async function transferOwnership(
  ctx: TenantContext,
  input: { memberId: string },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  requirePermission(ctx, 'workspace:transfer_ownership');

  const target = await findMemberById(prisma, ctx.workspaceId, input.memberId);
  if (!target) throw new NotFoundError('Team member');

  enforce(
    canTransferOwnership(
      { role: ctx.role, membershipId: ctx.membershipId },
      { role: target.role, membershipId: target.id, status: target.status },
    ),
  );

  await prisma.$transaction(async (tx) => {
    assertTouched(
      await updateMemberRole(tx, ctx.workspaceId, target.id, 'OWNER'),
      'Team member',
    );
    // The outgoing owner becomes an ADMIN rather than losing access — they still
    // run the business day to day, and locking them out would be a surprise.
    assertTouched(
      await updateMemberRole(tx, ctx.workspaceId, ctx.membershipId, 'ADMIN'),
      'Your membership',
    );
  });

  await appendAuditLog(prisma, {
    action: 'workspace.ownership_transferred',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'Workspace',
    resourceId: ctx.workspaceId,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    metadata: { toUserId: target.userId, toEmail: target.user.email, previousOwnerBecame: 'ADMIN' },
  });

  logger.warn('team.ownership.transferred', {
    workspaceId: ctx.workspaceId,
    fromMemberId: ctx.membershipId,
    toMemberId: target.id,
    requestId: ctx.requestId,
  });
}

export async function leaveWorkspace(
  ctx: TenantContext,
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const activeOwnerCount = await countOwners(prisma, ctx.workspaceId);
  enforce(canLeave({ role: ctx.role, membershipId: ctx.membershipId }, { activeOwnerCount }));

  assertTouched(await deleteMember(prisma, ctx.workspaceId, ctx.membershipId), 'Your membership');

  await appendAuditLog(prisma, {
    action: 'member.left',
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    resourceType: 'WorkspaceMember',
    resourceId: ctx.membershipId,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    metadata: { role: ctx.role },
  });
}

// ── Accepting an invitation ────────────────────────────────────────────────
//
// These two run *outside* a tenant context. The person holding the link is not a
// member of the workspace yet, so there is nothing to scope by — the token is the
// credential, and the workspace comes back from the row.

export type InvitePreview = {
  workspaceName: string;
  workspaceSlug: string;
  email: string;
  role: WorkspaceRole;
};

export async function previewInvite(token: string): Promise<InvitePreview> {
  const invite = await findInviteByTokenHash(prisma, sha256(token));
  // An unknown token and a settled one both report the same way, so a probe cannot
  // distinguish "never existed" from "already used".
  if (!invite) throw new NotFoundError('Invitation');

  const state = classifyInvite(invite);
  if (state !== 'valid') throw new BusinessRuleError(INVITE_STATE_MESSAGES[state]);

  return {
    workspaceName: invite.workspace.name,
    workspaceSlug: invite.workspace.slug,
    email: invite.email,
    role: invite.role,
  };
}

export type AcceptedInvite = { workspaceId: string; workspaceSlug: string; workspaceName: string };

export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<AcceptedInvite> {
  const invite = await findInviteByTokenHash(prisma, sha256(token));
  if (!invite) throw new NotFoundError('Invitation');

  const state = classifyInvite(invite);
  if (state !== 'valid') throw new BusinessRuleError(INVITE_STATE_MESSAGES[state]);

  const match = canAcceptInvite(invite.email, user.email);
  if (!match.allowed) throw new ForbiddenError(match.reason);

  const already = await findMemberByUserId(prisma, invite.workspaceId, user.id);
  if (already) {
    // Idempotent: a double-clicked link should land them in the workspace, not on
    // an error page. The invite is settled either way.
    await markInviteAccepted(prisma, invite.id, new Date());
    return {
      workspaceId: invite.workspaceId,
      workspaceSlug: invite.workspace.slug,
      workspaceName: invite.workspace.name,
    };
  }

  const membership = await prisma.$transaction(async (tx) => {
    const created = await createMember(tx, {
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      invitedByUserId: null,
    });
    await markInviteAccepted(tx, invite.id, new Date());
    return created;
  });

  await appendAuditLog(prisma, {
    action: 'member.joined',
    workspaceId: invite.workspaceId,
    actorUserId: user.id,
    actorMemberId: membership.id,
    resourceType: 'WorkspaceMember',
    resourceId: membership.id,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
    metadata: { role: invite.role, inviteId: invite.id },
  });

  await appendProductEvent(prisma, {
    name: 'team_member_joined',
    workspaceId: invite.workspaceId,
    userId: user.id,
    properties: { role: invite.role },
  });

  return {
    workspaceId: invite.workspaceId,
    workspaceSlug: invite.workspace.slug,
    workspaceName: invite.workspace.name,
  };
}
