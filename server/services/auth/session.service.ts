/**
 * Session lifecycle.
 *
 * Three operations: mint a session, validate one on an incoming request, and
 * revoke. The interesting one is validation, because it also applies the
 * half-life renewal — the session slides forward on use so an active person is
 * not signed out mid-task, but only when past the halfway mark so a busy request
 * does not write to the database on every page view.
 *
 * The token is generated here and returned once, to be put in the cookie. Only
 * its digest is persisted, so this is the only moment the raw token exists
 * outside the browser.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import type { AuthenticatedUser } from '@/server/tenancy/context';
import {
  createSessionLifetime,
  generateSessionToken,
  hashSessionToken,
  validateSessionLifetime,
} from '@/server/auth/session-token';
import {
  createSession,
  deleteAllSessionsForUser,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
  renewSession,
} from '@/server/repositories/session.repository';

export type IssuedSession = {
  token: string;
  expiresAt: Date;
};

export type SessionActor = {
  sessionId: string;
  user: AuthenticatedUser;
  isPlatformAdmin: boolean;
};

export async function issueSession(
  input: { userId: string; ipAddress?: string | null; userAgent?: string | null },
  now: Date = new Date(),
  db: Db = prisma,
): Promise<IssuedSession> {
  const token = generateSessionToken();
  const { expiresAt } = createSessionLifetime(now);

  await createSession(db, {
    userId: input.userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { token, expiresAt };
}

/**
 * Resolves a token to an actor, or null if there is no valid session.
 *
 * A session for a soft-deleted user is treated as absent. An expired session is
 * deleted on read rather than left to a sweep, so a stale cookie is cleaned up
 * the moment it is presented. When renewal is due the expiry slides forward and
 * the new expiry is returned so the caller can refresh the cookie.
 *
 * `renew` is off for Server Component render, because a component may not set a
 * cookie — only a Server Action or Route Handler may. Those paths pass `renew:
 * true`, so an active user's session still slides forward on any interaction
 * that mutates, which is the realistic renewal moment anyway.
 */
export async function validateSession(
  token: string,
  options: { now?: Date; renew?: boolean; db?: Db } = {},
): Promise<{ actor: SessionActor; renewedExpiry: Date | null } | null> {
  const now = options.now ?? new Date();
  const renew = options.renew ?? true;
  const db = options.db ?? prisma;

  const tokenHash = hashSessionToken(token);
  const session = await findSessionByTokenHash(db, tokenHash);
  if (!session) return null;

  if (session.user.deletedAt !== null) {
    await deleteSessionByTokenHash(db, tokenHash);
    return null;
  }

  const lifetime = validateSessionLifetime(session.expiresAt, now);
  if (lifetime.state === 'expired') {
    await deleteSessionByTokenHash(db, tokenHash);
    return null;
  }

  let renewed: Date | null = null;
  if (renew && lifetime.renew) {
    await renewSession(db, session.id, lifetime.expiresAt, now);
    renewed = lifetime.expiresAt;
  }

  const actor: SessionActor = {
    sessionId: session.id,
    isPlatformAdmin: session.user.isPlatformAdmin,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerifiedAt: session.user.emailVerifiedAt,
      avatarUrl: session.user.avatarUrl,
    },
  };

  return { actor, renewedExpiry: renewed };
}

export async function revokeSession(token: string, db: Db = prisma): Promise<void> {
  await deleteSessionByTokenHash(db, hashSessionToken(token));
}

export async function revokeAllSessions(userId: string, db: Db = prisma): Promise<number> {
  return deleteAllSessionsForUser(db, userId);
}
