/**
 * Workspace and membership repository.
 *
 * This one sits at the seam between "who is this person" and "what workspace are
 * they acting in". The read that resolves a `TenantContext` — find the caller's
 * membership in a given workspace, with the role and the plan — lives here, and
 * it is deliberately keyed on `(workspaceId, userId)` so that a person with no
 * membership gets `null` rather than someone else's workspace.
 *
 * Workspace creation is a multi-row invariant (workspace + owner membership +
 * trial subscription + business-profile shell), so the service runs it inside a
 * transaction and passes the transaction client in as `Db`. These functions are
 * the primitives that composition is built from.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { WorkspaceRole } from '@/server/authz/permissions';

export type MembershipContextRow = {
  membershipId: string;
  role: WorkspaceRole;
  membershipStatus: 'ACTIVE' | 'SUSPENDED';
  workspace: {
    id: string;
    slug: string;
    name: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
    currency: string;
    onboardingCompletedSteps: string[];
    onboardingCompletedAt: Date | null;
  };
  planKey: string | null;
};

/**
 * The caller's membership in one workspace, with everything a `TenantContext`
 * needs. Returns null when the user is not a member — which is the isolation
 * boundary: an id the caller does not belong to is indistinguishable from one
 * that does not exist.
 */
export async function findMembershipForContext(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<MembershipContextRow | null> {
  const row = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      id: true,
      role: true,
      status: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          currency: true,
          deletedAt: true,
          onboardingCompletedSteps: true,
          onboardingCompletedAt: true,
          subscription: { select: { planKey: true } },
        },
      },
    },
  });

  if (!row || row.workspace.deletedAt !== null) return null;

  return {
    membershipId: row.id,
    role: row.role,
    membershipStatus: row.status,
    workspace: {
      id: row.workspace.id,
      slug: row.workspace.slug,
      name: row.workspace.name,
      status: row.workspace.status,
      currency: row.workspace.currency,
      onboardingCompletedSteps: row.workspace.onboardingCompletedSteps,
      onboardingCompletedAt: row.workspace.onboardingCompletedAt,
    },
    planKey: row.workspace.subscription?.planKey ?? null,
  };
}

/** Same resolution, but from a slug — the URL segment the app routes on. */
export async function findMembershipBySlug(
  db: Db,
  slug: string,
  userId: string,
): Promise<MembershipContextRow | null> {
  const workspace = await db.workspace.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true },
  });
  if (!workspace) return null;
  return findMembershipForContext(db, workspace.id, userId);
}

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  onboardingCompletedAt: Date | null;
};

/**
 * Every workspace the user can act in, most recently active first. Powers the
 * workspace switcher and the post-login redirect decision.
 */
export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db.workspaceMember.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      workspace: { deletedAt: null },
    },
    select: {
      role: true,
      lastActiveAt: true,
      createdAt: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          onboardingCompletedAt: true,
        },
      },
    },
    orderBy: [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });

  return rows.map((row) => ({
    id: row.workspace.id,
    slug: row.workspace.slug,
    name: row.workspace.name,
    role: row.role,
    status: row.workspace.status,
    onboardingCompletedAt: row.workspace.onboardingCompletedAt,
  }));
}

export async function countWorkspacesForUser(db: Db, userId: string): Promise<number> {
  return db.workspaceMember.count({
    where: { userId, status: 'ACTIVE', workspace: { deletedAt: null } },
  });
}

export async function slugExists(db: Db, slug: string): Promise<boolean> {
  const found = await db.workspace.findFirst({ where: { slug }, select: { id: true } });
  return found !== null;
}

export type CreateWorkspaceInput = {
  slug: string;
  name: string;
  category?: string | null;
  currency?: string;
  timezone?: string;
};

export async function createWorkspace(
  db: Db,
  input: CreateWorkspaceInput,
): Promise<{ id: string; slug: string; name: string }> {
  return db.workspace.create({
    data: {
      slug: input.slug,
      name: input.name.trim(),
      category: input.category ?? null,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      onboardingCompletedSteps: ['business_created'],
    },
    select: { id: true, slug: true, name: true },
  });
}

export async function createMembership(
  db: Db,
  input: { workspaceId: string; userId: string; role: WorkspaceRole; invitedByUserId?: string | null },
): Promise<{ id: string }> {
  return db.workspaceMember.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      invitedByUserId: input.invitedByUserId ?? null,
    },
    select: { id: true },
  });
}

export async function createBusinessProfileShell(
  db: Db,
  workspaceId: string,
  data: { category?: string | null; country?: string },
): Promise<void> {
  await db.businessProfile.create({
    data: {
      workspaceId,
      category: data.category ?? null,
      ...(data.country ? { country: data.country } : {}),
    },
  });
}

/** Records activity so the switcher can order by "where I was last". Best-effort
 *  — a failure here must never break a request, so callers ignore the result. */
export async function touchMemberActivity(db: Db, membershipId: string, at: Date): Promise<void> {
  await db.workspaceMember.update({
    where: { id: membershipId },
    data: { lastActiveAt: at },
  });
}

export type OnboardingState = {
  completedSteps: string[];
  completedAt: Date | null;
};

/**
 * The onboarding checklist state for one workspace. Scoped by `workspaceId` and
 * read directly rather than threaded through `TenantContext`, which stays lean —
 * only the dashboard needs this, and only on render.
 */
export async function getOnboardingState(
  db: Db,
  workspaceId: string,
): Promise<OnboardingState> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { onboardingCompletedSteps: true, onboardingCompletedAt: true },
  });
  return {
    completedSteps: workspace?.onboardingCompletedSteps ?? [],
    completedAt: workspace?.onboardingCompletedAt ?? null,
  };
}

/** Adds a step to the onboarding checklist without clobbering the existing
 *  array. Idempotent: re-completing a step is a no-op. */
export async function markOnboardingStep(
  db: Db,
  workspaceId: string,
  step: string,
  allComplete: boolean,
  now: Date,
): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { onboardingCompletedSteps: true, onboardingCompletedAt: true },
  });
  if (!workspace) return;

  const steps = new Set(workspace.onboardingCompletedSteps);
  steps.add(step);

  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      onboardingCompletedSteps: [...steps],
      ...(allComplete && !workspace.onboardingCompletedAt ? { onboardingCompletedAt: now } : {}),
    },
  });
}
