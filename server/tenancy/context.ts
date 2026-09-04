/**
 * Tenant context and the isolation guarantee.
 *
 * Every request that touches tenant data resolves a `TenantContext` first. It is
 * the only source of `workspaceId` for a query — a workspace id taken from a
 * request body, a query string, or a client-supplied header is never trusted,
 * because the whole attack is "send someone else's id and see what comes back".
 *
 * Three layers, deliberately redundant. Any one of them would probably be enough;
 * the point is that a single mistake in one layer does not leak a customer list.
 *
 *   1. This module. Membership is verified against the database on every request,
 *      so the id is one the caller demonstrably belongs to.
 *   2. The repositories. Every query is constructed with `workspaceId` in the
 *      WHERE clause, and ESLint forbids reaching past them to Prisma.
 *   3. `assertBelongsToWorkspace`, below. A post-read assertion that re-checks the
 *      row actually returned, which catches a query someone wrote without the
 *      scope.
 *
 * A fourth layer — PostgreSQL row-level security — is planned for Phase 9. It
 * would make isolation a property of the database rather than the application,
 * but it needs a session-variable-setting connection wrapper that is easier to add
 * once the query surface has stopped moving.
 */

import 'server-only';

import type { SupportedCurrency } from '@/config/constants';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/server/errors';
import {
  type Permission,
  roleHasPermission,
  type WorkspaceRole,
} from '@/server/authz/permissions';

export type AuthenticatedUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerifiedAt: Date | null;
  readonly avatarUrl: string | null;
};

/**
 * How far through setup a workspace is.
 *
 * Rides on the context because the membership read that proves access already
 * selects both columns from the same `Workspace` row — the dashboard used to
 * re-read them in a second query for no gain.
 */
export type WorkspaceOnboardingState = {
  readonly completedSteps: string[];
  readonly completedAt: Date | null;
};

/**
 * A verified caller acting inside one workspace.
 *
 * Construction is the security check. If you are holding one of these, membership
 * has already been proven against the database — which is why nothing downstream
 * needs to re-derive it, and why `workspaceId` must never be reassigned.
 */
export type TenantContext = {
  readonly user: AuthenticatedUser;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly role: WorkspaceRole;
  readonly membershipId: string;
  readonly sessionId: string;
  /** The workspace's display currency, for formatting money the caller sees.
   *  Threaded here because money is pervasive and the membership read already
   *  loads it — a per-page currency fetch would be a needless second query. */
  readonly currency: SupportedCurrency;
  /** Resolved plan key, for limit checks without a second query. */
  readonly planKey: string;
  /** Setup progress, for the dashboard checklist. Same reasoning as `currency`:
   *  already on the membership row, so reading it again would be a wasted hop. */
  readonly onboarding: WorkspaceOnboardingState;
  /** Correlates every log line and error response for this request. */
  readonly requestId: string;
};

/**
 * Who is acting inside a workspace, without assuming they are a person.
 *
 * The AI agent is a real actor with real authority, but it is not a member: no
 * `WorkspaceMember` row exists for it, so it has no membership id, no user, and no
 * session. It used to be handed to `createOrder` as a `TenantContext` built by
 * `as unknown as TenantContext` with `membershipId: null as unknown as string` — a
 * cast that compiled by asserting something false, so any service that dereferenced
 * that id would have failed at runtime on the AI path and only on the AI path.
 *
 * This type is the honest shape instead: exactly the five fields order creation
 * reads, with the membership id nullable because for the agent it genuinely is null.
 * A full `TenantContext` satisfies it structurally — `string` is assignable to
 * `string | null` — so every human call site compiles unchanged, and the database
 * columns behind it (`Order.createdByMemberId`, `OrderEvent.actorMemberId`) were
 * already nullable.
 *
 * Note what is *not* here: a permission set. Authorization runs off `role` through
 * the same `requirePermission` every human path uses, so the agent is constrained by
 * the `AGENT` role rather than by a list it carries with it.
 */
export type WorkspaceActorContext = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: WorkspaceRole;
  /** Null for the AI agent, which acts with a role but holds no membership. */
  readonly membershipId: string | null;
  readonly currency: SupportedCurrency;
};

/** A caller who is signed in but not yet acting in a workspace — during onboarding,
 *  or on the workspace picker. */
export type UserContext = {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
  readonly requestId: string;
};

// ── Permission enforcement ─────────────────────────────────────────────────

/**
 * The only field a permission check reads.
 *
 * Declared so the three functions below accept either a `TenantContext` or a
 * `WorkspaceActorContext` without either type having to know about the other.
 * Widening a parameter cannot weaken the check — the body is unchanged and every
 * existing caller still satisfies it; it only stops a caller who legitimately has a
 * role from having to fabricate a user and a session to prove it.
 */
type RoleBearingContext = {
  readonly role: WorkspaceRole;
};

/**
 * Throws unless the context's role holds `permission`.
 *
 * Called at the top of every mutating service method. Hiding a button is a
 * courtesy to the user; this is the actual control, and it runs on the server
 * where the client cannot reach it.
 */
export function requirePermission(context: RoleBearingContext, permission: Permission): void {
  if (!roleHasPermission(context.role, permission)) {
    throw new ForbiddenError(
      `Your role (${context.role.toLowerCase()}) cannot perform this action.`,
    );
  }
}

export function requireAnyPermission(
  context: RoleBearingContext,
  permissions: readonly Permission[],
): void {
  if (!permissions.some((permission) => roleHasPermission(context.role, permission))) {
    throw new ForbiddenError(
      `Your role (${context.role.toLowerCase()}) cannot perform this action.`,
    );
  }
}

export function can(context: RoleBearingContext, permission: Permission): boolean {
  return roleHasPermission(context.role, permission);
}

/** For rendering: the UI asks once and hides what the server would refuse anyway.
 *  Convenience, not enforcement. */
export function capabilities(context: TenantContext) {
  return {
    can: (permission: Permission) => roleHasPermission(context.role, permission),
    role: context.role,
  };
}

// ── The post-read assertion ────────────────────────────────────────────────

/**
 * Confirms a row that came back from the database belongs to this workspace.
 *
 * Deliberately throws `NotFoundError`, never `ForbiddenError`. A 403 on someone
 * else's record confirms that the id is real, and an attacker who can tell 403
 * from 404 can walk the id space and count a competitor's orders. From outside,
 * "not yours" and "does not exist" must be indistinguishable.
 *
 * Cheap enough to call on every read, so call it on every read.
 */
export function assertBelongsToWorkspace<T extends { workspaceId: string }>(
  row: T | null | undefined,
  workspaceId: string,
  resource = 'Resource',
): T {
  if (!row || row.workspaceId !== workspaceId) {
    throw new NotFoundError(resource);
  }
  return row;
}

/** Array form. One foreign row poisons the whole response rather than being
 *  quietly filtered out — silent filtering hides the bug that produced it. */
export function assertAllBelongToWorkspace<T extends { workspaceId: string }>(
  rows: readonly T[],
  workspaceId: string,
  resource = 'Resource',
): readonly T[] {
  for (const row of rows) {
    if (row.workspaceId !== workspaceId) {
      throw new NotFoundError(resource);
    }
  }
  return rows;
}

/**
 * Guards a workspace id that arrived from outside — a URL segment or a form field.
 *
 * The only legitimate use is confirming that a client-supplied id matches the one
 * already proven by the session. It is never a way to *choose* a workspace.
 */
export function assertWorkspaceMatches(context: TenantContext, candidate: string): void {
  if (candidate !== context.workspaceId) {
    throw new NotFoundError('Workspace');
  }
}

export function requireAuthenticated<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new UnauthenticatedError();
  }
  return value;
}

/**
 * Whether this role sees the whole inbox or only its own assignments.
 *
 * The absence of `conversation:read_all` is what drives the extra WHERE clause in
 * the conversation repository, so an AGENT's list query is narrowed in SQL rather
 * than in the component.
 */
export function conversationScope(
  context: TenantContext,
): { kind: 'all' } | { kind: 'assigned'; userId: string } {
  return roleHasPermission(context.role, 'conversation:read_all')
    ? { kind: 'all' }
    : { kind: 'assigned', userId: context.user.id };
}
