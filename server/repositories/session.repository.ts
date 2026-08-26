/**
 * Session repository.
 *
 * Cross-tenant, like users: a session authenticates a person, not a workspace.
 * Sessions are looked up by the SHA-256 digest of the token — never by the token
 * itself, which is never stored — so a database dump yields nothing replayable.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type SessionWithUser = {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: Date | null;
    avatarUrl: string | null;
    isPlatformAdmin: boolean;
    deletedAt: Date | null;
  };
};

export type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function createSession(db: Db, input: CreateSessionInput): Promise<{ id: string }> {
  const row = await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });
  return row;
}

/** Joins the user so a validated request has the account in one round trip. */
export async function findSessionByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<SessionWithUser | null> {
  return db.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      createdAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          isPlatformAdmin: true,
          deletedAt: true,
        },
      },
    },
  });
}

/** Slides the expiry forward and records use. Called only when the lifetime
 *  rule says renewal is due, so this is roughly one write per fortnight per
 *  active session rather than one per request. */
export async function renewSession(
  db: Db,
  id: string,
  expiresAt: Date,
  lastUsedAt: Date,
): Promise<void> {
  await db.session.update({ where: { id }, data: { expiresAt, lastUsedAt } });
}

export async function deleteSessionByTokenHash(db: Db, tokenHash: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash } });
}

export async function deleteSessionById(db: Db, id: string): Promise<void> {
  await db.session.deleteMany({ where: { id } });
}

/** Signs a user out of every device — the reason sessions are stateful. */
export async function deleteAllSessionsForUser(db: Db, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

/** Housekeeping for a scheduled job; expired rows are already rejected on read. */
export async function deleteExpiredSessions(db: Db, now: Date): Promise<number> {
  const result = await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
