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
 * The columns a `TenantContext` is built from.
 *
 * Shared by both resolution paths — by id and by slug — deliberately. The two
 * used to carry their own copies of this shape, and a field added to one but not
 * the other is exactly the kind of divergence that shows up as a context missing
 * its plan key on one route only.
 */
const MEMBERSHIP_CONTEXT_SELECT = {
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
} as const;

/** The row shape `MEMBERSHIP_CONTEXT_SELECT` returns, named so the mapper below
 *  can be typed without restating it. */
type MembershipContextSelection = {
  id: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED';
  workspace: {
    id: string;
    slug: string;
    name: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
    currency: string;
    deletedAt: Date | null;
    onboardingCompletedSteps: string[];
    onboardingCompletedAt: Date | null;
    subscription: { planKey: string } | null;
  };
};

/**
 * Maps a selected row to the context shape, or null for a soft-deleted
 * workspace.
 *
 * The `deletedAt` filter is applied in SQL *and* re-checked here. Redundant on
 * purpose: this is the layered-isolation habit from `tenancy/context.ts`, and the
 * cost of one null comparison is not worth reasoning about.
 */
function toMembershipContextRow(
  row: MembershipContextSelection | null,
): MembershipContextRow | null {
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
    select: MEMBERSHIP_CONTEXT_SELECT,
  });

  return toMembershipContextRow(row);
}

/**
 * Same resolution, but from a slug — the URL segment the app routes on.
 *
 * Filters the membership through the workspace relation rather than looking the
 * slug up first and keying on the id it returns. Same guarantee, one fewer round
 * trip: the scope is still `userId`, so a slug the caller is not a member of
 * yields null exactly as before, and a slug that does not exist is
 * indistinguishable from one that does — which is the property that stops an
 * attacker enumerating other tenants' workspace names.
 *
 * `findFirst` rather than `findUnique` because the filter spans a relation, but
 * at most one row can match: `Workspace.slug` is unique and
 * `WorkspaceMember(workspaceId, userId)` is unique, so the result is
 * deterministic without an `orderBy`.
 */
export async function findMembershipBySlug(
  db: Db,
  slug: string,
  userId: string,
): Promise<MembershipContextRow | null> {
  const row = await db.workspaceMember.findFirst({
    where: { userId, workspace: { slug, deletedAt: null } },
    select: MEMBERSHIP_CONTEXT_SELECT,
  });

  return toMembershipContextRow(row);
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

/**
 * The workspace's country, as an ISO 3166-1 alpha-2 code.
 *
 * Read from `BusinessProfile` because that is where the business's own address
 * lives. It matters more than it looks: it is the default country for phone
 * normalisation, so it decides whether a customer who typed `0300 1234567`
 * becomes `+923001234567` or `+443001234567`. Falls back to the column default
 * rather than throwing, because a workspace mid-onboarding has no profile row yet
 * and refusing to save a contact over that would be absurd.
 */
export async function getWorkspaceCountry(db: Db, workspaceId: string): Promise<string> {
  const profile = await db.businessProfile.findUnique({
    where: { workspaceId },
    select: { country: true },
  });
  return profile?.country ?? 'PK';
}

/**
 * The workspace's display currency, as the raw column value.
 *
 * Returned unnarrowed because the column is a plain `String` and the caller decides
 * what an unrecognised value should do — `coerceCurrency` falls back to the default
 * rather than throwing, which is the right behaviour when the alternative is
 * refusing to price an order at all.
 */
export async function findWorkspaceCurrency(
  db: Db,
  workspaceId: string,
): Promise<string | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { currency: true },
  });
  return workspace?.currency ?? null;
}

/**
 * The three settings that decide what an order costs beyond the goods themselves.
 *
 * Kept separate from the customer-facing profile read below because this one feeds
 * arithmetic and that one feeds a sentence the AI says out loud. Both are scoped by
 * `workspaceId`, which is the unique key on the table, so a lookup cannot return
 * another tenant's row.
 */
export type BusinessMoneySettingsRow = {
  deliveryFeeMinor: number;
  /** Null means no threshold is configured, which is not the same as zero. */
  freeDeliveryThresholdMinor: number | null;
  taxRateBps: number;
};

/**
 * Never null.
 *
 * A workspace mid-onboarding has no profile row, and an order placed in that window
 * must still price correctly. Falling back to the column defaults — no fee, no
 * threshold, no tax — charges the customer for the goods and nothing else, which is
 * the only defensible answer when the business has not said otherwise.
 */
export async function findBusinessMoneySettings(
  db: Db,
  workspaceId: string,
): Promise<BusinessMoneySettingsRow> {
  const profile = await db.businessProfile.findUnique({
    where: { workspaceId },
    select: {
      deliveryFeeMinor: true,
      freeDeliveryThresholdMinor: true,
      taxRateBps: true,
    },
  });

  return {
    deliveryFeeMinor: profile?.deliveryFeeMinor ?? 0,
    freeDeliveryThresholdMinor: profile?.freeDeliveryThresholdMinor ?? null,
    taxRateBps: profile?.taxRateBps ?? 0,
  };
}

/**
 * The profile columns a customer is allowed to be told about.
 *
 * The `select` below is the enforcement, not a convenience: `logoStorageKey`,
 * `privacyPolicy`, the street address, the surrogate ids and the timestamps are
 * never loaded, so no later refactor of the tool that consumes this can leak them by
 * spreading an object. The street address is excluded on purpose — plenty of
 * Pakistani online sellers run the business from home, and handing that out to
 * anyone who asks the chatbot is not a decision they opted into. City and country
 * are coarse enough to answer "where are you based?".
 */
export type CustomerFacingBusinessProfileRow = {
  legalName: string | null;
  description: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  website: string | null;
  city: string | null;
  country: string;
  businessHours: unknown;
  shippingPolicy: string | null;
  returnPolicy: string | null;
  paymentMethods: string[];
  deliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number | null;
  taxRateBps: number;
};

export async function findCustomerFacingBusinessProfile(
  db: Db,
  workspaceId: string,
): Promise<CustomerFacingBusinessProfileRow | null> {
  const profile = await db.businessProfile.findUnique({
    where: { workspaceId },
    select: {
      legalName: true,
      description: true,
      supportPhone: true,
      supportEmail: true,
      website: true,
      city: true,
      country: true,
      businessHours: true,
      shippingPolicy: true,
      returnPolicy: true,
      paymentMethods: true,
      deliveryFeeMinor: true,
      freeDeliveryThresholdMinor: true,
      taxRateBps: true,
    },
  });

  return profile ?? null;
}

/** Records activity so the switcher can order by "where I was last". Best-effort
 *  — a failure here must never break a request, so callers ignore the result. */
export async function touchMemberActivity(db: Db, membershipId: string, at: Date): Promise<void> {
  await db.workspaceMember.update({
    where: { id: membershipId },
    data: { lastActiveAt: at },
  });
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
