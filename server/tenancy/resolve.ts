/**
 * Request-time resolution of who the caller is and which workspace they are in.
 *
 * This is the bridge between the two things a request arrives with — a session
 * cookie and (maybe) an active-workspace slug — and the two things the rest of
 * the code wants: a `UserContext` for the signed-in-but-not-yet-in-a-workspace
 * screens, and a fully-verified `TenantContext` for everything inside a
 * workspace. Membership is proven against the database here, every time; the
 * slug from the cookie is only ever a *hint* about which workspace to try, never
 * a grant of access to it.
 *
 * A Next.js constraint shapes the two flavours of session read. A Server
 * Component may read cookies but may not set them — only a Server Action or
 * Route Handler may. So render-path reads (`getSessionActor`) validate without
 * sliding the session forward, and the mutation path (`getSessionActorRenewing`)
 * slides it and refreshes the cookie. An active person mutates often enough that
 * the session stays fresh; a session is 30 days with renewal past the halfway
 * mark, so this is comfortable in practice.
 */

import 'server-only';

import { cache } from 'react';

import { prisma } from '@/db/prisma';
import { coerceCurrency } from '@/lib/money';
import { requestId } from '@/lib/ids';
import {
  getActiveWorkspaceSlug,
  getSessionToken,
  setSessionCookie,
} from '@/server/auth/cookies';
import { UnauthenticatedError } from '@/server/errors';
import {
  findMembershipBySlug,
  findMembershipForContext,
  type MembershipContextRow,
} from '@/server/repositories/workspace.repository';
import {
  validateSession,
  type SessionActor,
} from '@/server/services/auth/session.service';
import type { TenantContext, UserContext } from '@/server/tenancy/context';

/**
 * The signed-in caller, or null. Safe to call during Server Component render:
 * it never writes a cookie and never slides the session.
 *
 * Memoised per request with React `cache`, so a layout and the page it wraps —
 * or several components in one render — share a single session lookup instead
 * of each hitting the database.
 */
export const getSessionActor = cache(async (): Promise<SessionActor | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const result = await validateSession(token, { renew: false });
  return result?.actor ?? null;
});

/**
 * The signed-in caller for a mutating path (Server Action / Route Handler),
 * sliding the session forward and refreshing the cookie when renewal is due.
 * Never call this during render — setting a cookie there throws.
 */
export async function getSessionActorRenewing(): Promise<SessionActor | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const result = await validateSession(token, { renew: true });
  if (!result) return null;

  if (result.renewedExpiry) {
    await setSessionCookie(token, result.renewedExpiry);
  }
  return result.actor;
}

export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const actor = await getSessionActor();
  if (!actor) return null;
  return { user: actor.user, sessionId: actor.sessionId, requestId: requestId() };
});

/**
 * Whether a membership row is one we will act on.
 *
 * A suspended *member* is refused outright — they have lost access. A suspended
 * *workspace* is still resolved, so the app can show a billing-hold screen and a
 * way to pay rather than a bare 404; the services still gate every mutation, so
 * "resolved" is not "unrestricted". An archived workspace is treated as gone.
 */
function isAccessibleMembership(row: MembershipContextRow): boolean {
  if (row.membershipStatus !== 'ACTIVE') return false;
  if (row.workspace.status === 'ARCHIVED') return false;
  return true;
}

function toTenantContext(
  actor: SessionActor,
  row: MembershipContextRow,
): TenantContext {
  return {
    user: actor.user,
    workspaceId: row.workspace.id,
    workspaceSlug: row.workspace.slug,
    workspaceName: row.workspace.name,
    role: row.role,
    membershipId: row.membershipId,
    sessionId: actor.sessionId,
    // Stored as free text on the row; narrowed to the supported union here so it
    // can format money downstream without a cast, failing closed to the default.
    currency: coerceCurrency(row.workspace.currency),
    // Fail closed: a workspace with no subscription row resolves to the free
    // plan's limits rather than to unmetered use.
    planKey: row.planKey ?? 'free',
    // Carried rather than re-read: the membership query above selects both
    // columns from the same `Workspace` row the dashboard would have queried.
    onboarding: {
      completedSteps: row.workspace.onboardingCompletedSteps,
      completedAt: row.workspace.onboardingCompletedAt,
    },
    requestId: requestId(),
  };
}

/**
 * Resolve the workspace the caller is acting in, or null.
 *
 * `preferredSlug` — the URL segment when the app routes on `/w/[slug]` — wins
 * over the active-workspace cookie, so a link into a specific workspace is
 * honoured. Either way membership is re-verified, so an unknown slug, a
 * workspace the caller does not belong to, a suspended membership, or an
 * archived workspace all resolve the same way: null, and the caller sends the
 * user to the picker.
 */
export const getTenantContext = cache(async (
  preferredSlug?: string | null,
): Promise<TenantContext | null> => {
  const actor = await getSessionActor();
  if (!actor) return null;

  const slug = preferredSlug ?? (await getActiveWorkspaceSlug());
  if (!slug) return null;

  const membership = await findMembershipBySlug(prisma, slug, actor.user.id);
  if (!membership || !isAccessibleMembership(membership)) return null;

  return toTenantContext(actor, membership);
});

/**
 * Resolve a workspace by id, verifying the caller belongs to it. For the rare
 * caller that already holds a trusted workspace id (a background job continuing
 * a request, say) rather than a slug.
 */
export const getTenantContextById = cache(async (
  workspaceId: string,
): Promise<TenantContext | null> => {
  const actor = await getSessionActor();
  if (!actor) return null;

  const membership = await findMembershipForContext(prisma, workspaceId, actor.user.id);
  if (!membership || !isAccessibleMembership(membership)) return null;

  return toTenantContext(actor, membership);
});

// ── Throwing variants, for Server Actions ──────────────────────────────────
//
// Actions want a hard failure, not a nullable to thread through. Pages, by
// contrast, use the nullable forms above and decide where to redirect — a
// redirect belongs in the routing layer, not here.

export async function requireUserContext(): Promise<UserContext> {
  const context = await getUserContext();
  if (!context) throw new UnauthenticatedError();
  return context;
}

export async function requireTenantContext(
  preferredSlug?: string | null,
): Promise<TenantContext> {
  const context = await getTenantContext(preferredSlug);
  if (!context) throw new UnauthenticatedError();
  return context;
}
