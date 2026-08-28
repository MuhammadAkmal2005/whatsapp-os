/**
 * WhatsApp Accounts and Phone Numbers repository.
 *
 * Workspace-scoped database access for WhatsApp credentials and routing configurations.
 * Enforces multi-tenant isolation and guarantees post-read workspace assertions.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { assertBelongsToWorkspace } from '@/server/tenancy/context';

export type ChannelStatus = 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR';

export type WhatsAppAccountRow = {
  id: string;
  workspaceId: string;
  wabaId: string;
  displayName: string | null;
  accessTokenEncrypted: string | null;
  status: ChannelStatus;
  isMock: boolean;
  connectedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WhatsAppPhoneNumberRow = {
  id: string;
  workspaceId: string;
  accountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  status: ChannelStatus;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WhatsAppPhoneNumberWithAccountRow = WhatsAppPhoneNumberRow & {
  account: WhatsAppAccountRow;
};

const ACCOUNT_SELECT = {
  id: true,
  workspaceId: true,
  wabaId: true,
  displayName: true,
  accessTokenEncrypted: true,
  status: true,
  isMock: true,
  connectedAt: true,
  lastErrorAt: true,
  lastErrorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PHONE_SELECT = {
  id: true,
  workspaceId: true,
  accountId: true,
  phoneNumberId: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  status: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function findAccountById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<WhatsAppAccountRow | null> {
  const row = await db.whatsAppAccount.findFirst({
    where: { id, workspaceId },
    select: ACCOUNT_SELECT,
  });
  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'WhatsAppAccount');
}

export async function findPhoneNumberById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<WhatsAppPhoneNumberWithAccountRow | null> {
  const row = await db.whatsAppPhoneNumber.findFirst({
    where: { id, workspaceId },
    select: {
      ...PHONE_SELECT,
      account: { select: ACCOUNT_SELECT },
    },
  });
  if (!row) return null;
  assertBelongsToWorkspace(row, workspaceId, 'WhatsAppPhoneNumber');
  assertBelongsToWorkspace(row.account, workspaceId, 'WhatsAppAccount');
  return row as WhatsAppPhoneNumberWithAccountRow;
}

export async function findDefaultPhoneNumberWithAccount(
  db: Db,
  workspaceId: string,
): Promise<WhatsAppPhoneNumberWithAccountRow | null> {
  // First try explicit default phone number
  let row = await db.whatsAppPhoneNumber.findFirst({
    where: { workspaceId, isDefault: true },
    select: {
      ...PHONE_SELECT,
      account: { select: ACCOUNT_SELECT },
    },
  });

  // If no explicit default, pick first connected or created phone number
  if (!row) {
    row = await db.whatsAppPhoneNumber.findFirst({
      where: { workspaceId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        ...PHONE_SELECT,
        account: { select: ACCOUNT_SELECT },
      },
    });
  }

  if (!row) return null;
  assertBelongsToWorkspace(row, workspaceId, 'WhatsAppPhoneNumber');
  assertBelongsToWorkspace(row.account, workspaceId, 'WhatsAppAccount');
  return row as WhatsAppPhoneNumberWithAccountRow;
}

/**
 * Resolves a phone number and its account across all workspaces by Meta's `phoneNumberId`.
 * CROSS-TENANT: Used exclusively for routing incoming webhooks to the correct tenant.
 */
export async function findPhoneNumberWithAccountByPhoneNumberId(
  db: Db,
  phoneNumberId: string,
): Promise<WhatsAppPhoneNumberWithAccountRow | null> {
  const row = await db.whatsAppPhoneNumber.findFirst({
    where: { phoneNumberId },
    select: {
      ...PHONE_SELECT,
      account: { select: ACCOUNT_SELECT },
    },
  });
  if (!row) return null;
  return row as WhatsAppPhoneNumberWithAccountRow;
}

export async function updateAccountError(
  db: Db,
  workspaceId: string,
  accountId: string,
  error: { lastErrorMessage: string; lastErrorAt?: Date },
): Promise<void> {
  await db.whatsAppAccount.updateMany({
    where: { id: accountId, workspaceId },
    data: {
      lastErrorMessage: error.lastErrorMessage,
      lastErrorAt: error.lastErrorAt ?? new Date(),
      status: 'ERROR',
    },
  });
}

export async function updateAccountStatus(
  db: Db,
  workspaceId: string,
  accountId: string,
  status: ChannelStatus,
): Promise<void> {
  await db.whatsAppAccount.updateMany({
    where: { id: accountId, workspaceId },
    data: { status },
  });
}
