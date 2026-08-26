/**
 * The Prisma client singleton.
 *
 * This is the only module permitted to construct a `PrismaClient`. ESLint
 * enforces that with `no-restricted-imports`: nothing outside `server/repositories`
 * may import from here, so every database access passes through a repository that
 * applies the workspace scope. That rule is the difference between tenant
 * isolation being a property of the system and being a habit that holds until
 * someone is in a hurry.
 */

import 'server-only';

import { PrismaClient } from '@prisma/client';

import { isDevelopment, isTest } from '@/config/env';

/** Next.js hot reload re-evaluates modules, and a fresh client per reload
 *  exhausts the connection pool within a few edits. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log: isDevelopment ? ['warn', 'error'] : ['error'],
    // Query text is logged, and query text contains customer phone numbers and
    // addresses. Never enable 'query' logging outside a local database.
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (isDevelopment || isTest) {
  globalForPrisma.prisma = prisma;
}

/** Prisma's transaction client — the subset available inside `$transaction`. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either the root client or a transaction client. Repositories accept this so
 *  the same method works inside and outside a transaction. */
export type Db = PrismaClient | PrismaTransaction;

/**
 * Whether an error is Postgres rejecting a duplicate against a unique index.
 *
 * Needed because a uniqueness check followed by an insert is a race: two messages
 * from the same customer arriving together both find no existing contact and both
 * try to create one. The loser gets P2002, and that is a normal outcome to be
 * translated into "this customer already exists" rather than a 500.
 *
 * Duck-typed rather than an `instanceof PrismaClientKnownRequestError`, because
 * that class is re-exported from more than one entry point and an instance
 * constructed under a different module instance would fail the check while being
 * exactly the error we mean.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

