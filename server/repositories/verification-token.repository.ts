/**
 * Verification Token repository.
 *
 * Cross-tenant: manages email verification and password reset tokens.
 * Single-use, hashed at rest with SHA-256.
 */

import 'server-only';

import type { VerificationPurpose } from '@prisma/client';

import type { Db } from '@/db/prisma';

export type VerificationTokenRow = {
  id: string;
  identifier: string;
  tokenHash: string;
  purpose: VerificationPurpose;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export async function createVerificationToken(
  db: Db,
  input: {
    identifier: string;
    tokenHash: string;
    purpose: VerificationPurpose;
    expiresAt: Date;
  },
): Promise<VerificationTokenRow> {
  return db.verificationToken.create({
    data: {
      identifier: input.identifier.toLowerCase().trim(),
      tokenHash: input.tokenHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
    },
  });
}

export async function findVerificationTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<VerificationTokenRow | null> {
  return db.verificationToken.findUnique({
    where: { tokenHash },
  });
}

export async function markVerificationTokenConsumed(
  db: Db,
  id: string,
  consumedAt: Date = new Date(),
): Promise<void> {
  await db.verificationToken.update({
    where: { id },
    data: { consumedAt },
  });
}

/**
 * Housekeeping for maintenance sweep.
 * Deletes expired tokens, or consumed tokens older than the retention boundary.
 */
export async function deleteExpiredVerificationTokens(
  db: Db,
  now: Date,
  consumedBefore?: Date,
): Promise<number> {
  const result = await db.verificationToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        ...(consumedBefore ? [{ consumedAt: { lte: consumedBefore } }] : []),
      ],
    },
  });
  return result.count;
}
