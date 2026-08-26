/**
 * Team membership and invitations.
 *
 * Every function here takes `workspaceId` and puts it in the `where` clause. That
 * is unremarkable for most tables, but membership is the table where a missing
 * scope is worst: reading another workspace's members leaks the names and email
 * addresses of a competitor's staff, and *writing* one grants an attacker a role
 * inside a business they have nothing to do with.
 *
 * Invites are looked up by token hash without a workspace scope, and that is the
 * one deliberate exception. An invited person is by definition not yet a member, so
 * there is no context to scope by — the unguessable token is the credential, and
 * the workspace comes back *from* the row rather than being supplied alongside it.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER';
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';

export type MemberRow = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  joinedAt: Date;
  lastActiveAt: Date | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
};

/** Selected explicitly rather than with `include`, so adding a column to User
 *  cannot silently start shipping it to the client. */
const MEMBER_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
  lastActiveAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

export async function listMembers(db: Db, workspaceId: string): Promise<MemberRow[]> {
  const rows = await db.workspaceMember.findMany({
    where: { workspaceId },
    select: MEMBER_SELECT,
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  return rows as MemberRow[];
}

export async function findMemberById(
  db: Db,
  workspaceId: string,
  memberId: string,
): Promise<MemberRow | null> {
  const row = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    select: MEMBER_SELECT,
  });
  return (row as MemberRow | null) ?? null;
}

export async function findMemberByUserId(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<MemberRow | null> {
  const row = await db.workspaceMember.findFirst({
    where: { userId, workspaceId },
    select: MEMBER_SELECT,
  });
  return (row as MemberRow | null) ?? null;
}

export async function countMembers(db: Db, workspaceId: string): Promise<number> {
  return db.workspaceMember.count({ where: { workspaceId } });
}

/** Used to refuse the removal or demotion that would leave a business with nobody
 *  who can pay the bill or delete the account. */
export async function countOwners(db: Db, workspaceId: string): Promise<number> {
  return db.workspaceMember.count({ where: { workspaceId, role: 'OWNER', status: 'ACTIVE' } });
}

export async function updateMemberRole(
  db: Db,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<number> {
  // `updateMany` with the scope in the filter, not `update` by id. `update` would
  // ignore the workspace and happily edit another tenant's row; this returns a
  // count of zero instead, which the service turns into NotFound.
  const result = await db.workspaceMember.updateMany({
    where: { id: memberId, workspaceId },
    data: { role },
  });
  return result.count;
}

export async function updateMemberStatus(
  db: Db,
  workspaceId: string,
  memberId: string,
  status: MembershipStatus,
): Promise<number> {
  const result = await db.workspaceMember.updateMany({
    where: { id: memberId, workspaceId },
    data: { status },
  });
  return result.count;
}

export async function deleteMember(db: Db, workspaceId: string, memberId: string): Promise<number> {
  const result = await db.workspaceMember.deleteMany({ where: { id: memberId, workspaceId } });
  return result.count;
}

export async function createMember(
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    invitedByUserId: string | null;
  },
): Promise<{ id: string }> {
  return db.workspaceMember.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      invitedByUserId: input.invitedByUserId,
    },
    select: { id: true },
  });
}

// ── Invitations ────────────────────────────────────────────────────────────

export type InviteRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  invitedBy: { name: string; email: string };
};

const INVITE_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  invitedBy: { select: { name: true, email: true } },
} as const;

/** Only the ones still actionable. A settled invite is history, and showing it in
 *  the pending list is how a business owner ends up chasing someone who joined. */
export async function listPendingInvites(db: Db, workspaceId: string): Promise<InviteRow[]> {
  const rows = await db.workspaceInvite.findMany({
    where: { workspaceId, acceptedAt: null, revokedAt: null },
    select: INVITE_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return rows as InviteRow[];
}

/**
 * Creates or replaces the invite for an email address.
 *
 * The unique constraint is on `(workspaceId, email)`, so re-inviting is an upsert
 * rather than an error. That matches what the person actually wants — "send it
 * again, they lost the email" — and it invalidates the previous token in the
 * process, because the row holds only one hash.
 */
export async function upsertInvite(
  db: Db,
  input: {
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  },
): Promise<{ id: string }> {
  return db.workspaceInvite.upsert({
    where: { workspaceId_email: { workspaceId: input.workspaceId, email: input.email } },
    create: {
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: input.tokenHash,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
    },
    update: {
      role: input.role,
      tokenHash: input.tokenHash,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  });
}

/**
 * Resolves an invite from its token.
 *
 * Unscoped by design — see the module note. The token is 32 bytes of CSPRNG
 * output and only its SHA-256 hash is stored, so a database read alone cannot be
 * turned back into a usable invite link.
 */
export async function findInviteByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<
  | {
      id: string;
      workspaceId: string;
      email: string;
      role: WorkspaceRole;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      workspace: { name: string; slug: string };
    }
  | null
> {
  return db.workspaceInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { name: true, slug: true } },
    },
  });
}

export async function markInviteAccepted(db: Db, inviteId: string, at: Date): Promise<void> {
  await db.workspaceInvite.update({ where: { id: inviteId }, data: { acceptedAt: at } });
}

export async function revokeInvite(
  db: Db,
  workspaceId: string,
  inviteId: string,
  at: Date,
): Promise<number> {
  const result = await db.workspaceInvite.updateMany({
    where: { id: inviteId, workspaceId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: at },
  });
  return result.count;
}

export async function countPendingInvites(db: Db, workspaceId: string): Promise<number> {
  return db.workspaceInvite.count({
    where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
}
