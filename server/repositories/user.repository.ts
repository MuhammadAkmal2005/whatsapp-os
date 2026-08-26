/**
 * User repository.
 *
 * Users are cross-tenant: a person is one account that can belong to several
 * workspaces, so this repository — unlike the tenant-scoped ones — has no
 * `workspaceId` to inject. It is still the only layer that talks to Prisma for
 * the `users` table, so the soft-delete filter lives here once rather than being
 * re-remembered at every call site.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
  passwordHash: string;
  locale: string;
  timezone: string;
  isPlatformAdmin: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const userSelect = {
  id: true,
  email: true,
  name: true,
  emailVerifiedAt: true,
  avatarUrl: true,
  passwordHash: true,
  locale: true,
  timezone: true,
  isPlatformAdmin: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Emails are stored and matched lowercased; the column has a unique index. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  return db.user.findFirst({
    where: { email: normaliseEmail(email), deletedAt: null },
    select: userSelect,
  });
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: userSelect,
  });
}

export async function emailExists(db: Db, email: string): Promise<boolean> {
  const found = await db.user.findFirst({
    where: { email: normaliseEmail(email), deletedAt: null },
    select: { id: true },
  });
  return found !== null;
}

export type CreateUserInput = {
  email: string;
  name: string;
  passwordHash: string;
  locale?: string;
  timezone?: string;
};

export async function createUser(db: Db, input: CreateUserInput): Promise<UserRecord> {
  return db.user.create({
    data: {
      email: normaliseEmail(input.email),
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    },
    select: userSelect,
  });
}

export async function markLoginAt(db: Db, id: string, at: Date): Promise<void> {
  await db.user.update({ where: { id }, data: { lastLoginAt: at } });
}

export async function updatePasswordHash(db: Db, id: string, passwordHash: string): Promise<void> {
  await db.user.update({ where: { id }, data: { passwordHash } });
}
