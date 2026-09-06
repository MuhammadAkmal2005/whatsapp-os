/**
 * WhatsApp Accounts and Phone Numbers repository.
 *
 * Workspace-scoped database access for WhatsApp credentials and routing configurations.
 * Enforces multi-tenant isolation and guarantees post-read workspace assertions.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { assertBelongsToWorkspace } from '@/server/tenancy/context';

/**
 * Mirrors the Prisma `ChannelStatus` enum.
 *
 * DEGRADED is what makes a health indicator honest: the connection has credentials
 * and history, but a real check found something wrong — the webhook subscription is
 * gone, the token is near expiry, the number is not registered. Collapsing it into
 * ERROR would make a routine warning look like an outage; collapsing it into
 * CONNECTED would hide a number that cannot actually send.
 */
export type ChannelStatus = 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'DEGRADED' | 'ERROR';

export type MetaTokenType = 'SYSTEM_USER' | 'BUSINESS_INTEGRATION';

export type MetaConnectionMethod = 'MANUAL_TOKEN' | 'EMBEDDED_SIGNUP' | 'MOCK';

export type WhatsAppAccountRow = {
  id: string;
  workspaceId: string;
  wabaId: string;
  metaBusinessId: string | null;
  displayName: string | null;
  /** Ciphertext. Decrypted only inside the provider factory; never sent to a client. */
  accessTokenEncrypted: string | null;
  tokenType: MetaTokenType | null;
  tokenExpiresAt: Date | null;
  tokenUpdatedAt: Date | null;
  connectionMethod: MetaConnectionMethod;
  status: ChannelStatus;
  isMock: boolean;
  connectedAt: Date | null;
  /** When `POST /<WABA_ID>/subscribed_apps` last succeeded. */
  subscribedAt: Date | null;
  /** When a GET on that edge last confirmed we are still subscribed. */
  subscriptionVerifiedAt: Date | null;
  lastInboundEventAt: Date | null;
  lastOutboundSuccessAt: Date | null;
  lastHealthCheckAt: Date | null;
  disconnectedAt: Date | null;
  disconnectedByMemberId: string | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
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
  codeVerificationStatus: string | null;
  platformType: string | null;
  throughputLevel: string | null;
  status: ChannelStatus;
  isDefault: boolean;
  /** Set once `POST /<PHONE_NUMBER_ID>/register` has succeeded. */
  registeredAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
// `registrationPinEncrypted` is deliberately absent from this row type. Nothing
// outside the registration call needs it, and a field that is never selected cannot
// be leaked by a careless spread into a server-component prop.

export type WhatsAppPhoneNumberWithAccountRow = WhatsAppPhoneNumberRow & {
  account: WhatsAppAccountRow;
};

export type WhatsAppAccountWithPhoneNumbersRow = WhatsAppAccountRow & {
  phoneNumbers: WhatsAppPhoneNumberRow[];
};

export type UpsertWhatsAppAccountData = {
  wabaId: string;
  metaBusinessId?: string | null;
  displayName?: string | null;
  accessTokenEncrypted?: string | null;
  tokenType?: MetaTokenType | null;
  tokenExpiresAt?: Date | null;
  connectionMethod?: MetaConnectionMethod;
  isMock: boolean;
  status: ChannelStatus;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName?: string | null;
  qualityRating?: string | null;
  codeVerificationStatus?: string | null;
  platformType?: string | null;
  throughputLevel?: string | null;
  isDefault?: boolean;
};

/** Connection metadata a health check or a lifecycle step writes back. */
export type AccountConnectionPatch = {
  status?: ChannelStatus;
  subscribedAt?: Date | null;
  subscriptionVerifiedAt?: Date | null;
  tokenExpiresAt?: Date | null;
  lastHealthCheckAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastErrorAt?: Date | null;
};

const ACCOUNT_SELECT = {
  id: true,
  workspaceId: true,
  wabaId: true,
  metaBusinessId: true,
  displayName: true,
  accessTokenEncrypted: true,
  tokenType: true,
  tokenExpiresAt: true,
  tokenUpdatedAt: true,
  connectionMethod: true,
  status: true,
  isMock: true,
  connectedAt: true,
  subscribedAt: true,
  subscriptionVerifiedAt: true,
  lastInboundEventAt: true,
  lastOutboundSuccessAt: true,
  lastHealthCheckAt: true,
  disconnectedAt: true,
  disconnectedByMemberId: true,
  lastErrorAt: true,
  lastErrorCode: true,
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
  codeVerificationStatus: true,
  platformType: true,
  throughputLevel: true,
  status: true,
  isDefault: true,
  registeredAt: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function findAccountsWithPhoneNumbers(
  db: Db,
  workspaceId: string,
): Promise<WhatsAppAccountWithPhoneNumbersRow[]> {
  const rows = await db.whatsAppAccount.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      ...ACCOUNT_SELECT,
      phoneNumbers: {
        select: PHONE_SELECT,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  return rows.map((row) =>
    assertBelongsToWorkspace(row, workspaceId, 'WhatsAppAccount'),
  ) as WhatsAppAccountWithPhoneNumbersRow[];
}

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
 * CROSS-TENANT: Used exclusively for routing incoming webhooks and cross-tenant collision detection.
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

export async function upsertWhatsAppAccountWithPhoneNumber(
  db: Db,
  workspaceId: string,
  data: UpsertWhatsAppAccountData,
): Promise<WhatsAppAccountWithPhoneNumbersRow> {
  const now = new Date();
  const tokenProvided = data.accessTokenEncrypted !== undefined;

  // 1. Upsert WhatsAppAccount. Targeting (workspaceId, wabaId) is what makes a
  //    reconnect update the existing row instead of creating a second connection
  //    record for the same business — the history stays attached to one account.
  const account = await db.whatsAppAccount.upsert({
    where: {
      workspaceId_wabaId: {
        workspaceId,
        wabaId: data.wabaId,
      },
    },
    create: {
      workspaceId,
      wabaId: data.wabaId,
      metaBusinessId: data.metaBusinessId ?? null,
      displayName: data.displayName ?? null,
      accessTokenEncrypted: data.accessTokenEncrypted ?? null,
      tokenType: data.tokenType ?? null,
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      tokenUpdatedAt: tokenProvided ? now : null,
      connectionMethod: data.connectionMethod ?? 'MANUAL_TOKEN',
      status: data.status,
      isMock: data.isMock,
      connectedAt: data.status === 'CONNECTED' ? now : null,
      lastErrorMessage: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
    update: {
      ...(data.metaBusinessId !== undefined && { metaBusinessId: data.metaBusinessId }),
      displayName: data.displayName !== undefined ? data.displayName : undefined,
      ...(tokenProvided && {
        accessTokenEncrypted: data.accessTokenEncrypted,
        tokenUpdatedAt: now,
      }),
      ...(data.tokenType !== undefined && { tokenType: data.tokenType }),
      ...(data.tokenExpiresAt !== undefined && { tokenExpiresAt: data.tokenExpiresAt }),
      ...(data.connectionMethod !== undefined && { connectionMethod: data.connectionMethod }),
      status: data.status,
      isMock: data.isMock,
      ...(data.status === 'CONNECTED' && {
        connectedAt: now,
        // A reconnect is not still disconnected. Leaving these set would make the
        // lifecycle read as two contradictory facts at once.
        disconnectedAt: null,
        disconnectedByMemberId: null,
      }),
      lastErrorMessage: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
    select: ACCOUNT_SELECT,
  });

  // 2. Upsert WhatsAppPhoneNumber
  await db.whatsAppPhoneNumber.upsert({
    where: {
      phoneNumberId: data.phoneNumberId,
    },
    create: {
      workspaceId,
      accountId: account.id,
      phoneNumberId: data.phoneNumberId,
      displayPhoneNumber: data.displayPhoneNumber,
      verifiedName: data.verifiedName ?? null,
      qualityRating: data.qualityRating ?? null,
      codeVerificationStatus: data.codeVerificationStatus ?? null,
      platformType: data.platformType ?? null,
      throughputLevel: data.throughputLevel ?? null,
      status: data.status,
      isDefault: data.isDefault ?? true,
    },
    update: {
      workspaceId,
      accountId: account.id,
      displayPhoneNumber: data.displayPhoneNumber,
      ...(data.verifiedName !== undefined && { verifiedName: data.verifiedName }),
      ...(data.qualityRating !== undefined && { qualityRating: data.qualityRating }),
      ...(data.codeVerificationStatus !== undefined && {
        codeVerificationStatus: data.codeVerificationStatus,
      }),
      ...(data.platformType !== undefined && { platformType: data.platformType }),
      ...(data.throughputLevel !== undefined && { throughputLevel: data.throughputLevel }),
      status: data.status,
    },
    select: PHONE_SELECT,
  });

  // 3. Return full account with all phone numbers
  const full = await db.whatsAppAccount.findUnique({
    where: { id: account.id },
    select: {
      ...ACCOUNT_SELECT,
      phoneNumbers: {
        select: PHONE_SELECT,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  return full as WhatsAppAccountWithPhoneNumbersRow;
}

export async function disconnectWhatsAppAccount(
  db: Db,
  workspaceId: string,
  accountId: string,
  actor?: { memberId?: string | null; at?: Date },
): Promise<void> {
  const at = actor?.at ?? new Date();

  // 1. Clear the token and record who disconnected. The row itself survives: the
  //    conversations, contacts and messages that reference it are the business's
  //    history, and deleting the account to "clean up" would orphan all of it.
  await db.whatsAppAccount.updateMany({
    where: { id: accountId, workspaceId },
    data: {
      accessTokenEncrypted: null,
      tokenType: null,
      tokenExpiresAt: null,
      status: 'DISCONNECTED',
      // The subscription is gone with the token; claiming otherwise would make a
      // later health check report a subscription we can no longer even query.
      subscribedAt: null,
      subscriptionVerifiedAt: null,
      disconnectedAt: at,
      disconnectedByMemberId: actor?.memberId ?? null,
      lastErrorMessage: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  });

  // 2. Update phone numbers: set status DISCONNECTED
  await db.whatsAppPhoneNumber.updateMany({
    where: { accountId, workspaceId },
    data: {
      status: 'DISCONNECTED',
      registeredAt: null,
      registrationPinEncrypted: null,
    },
  });
}

export async function updateAccountError(
  db: Db,
  workspaceId: string,
  accountId: string,
  error: { lastErrorMessage: string; lastErrorCode?: string | null; lastErrorAt?: Date },
): Promise<void> {
  await db.whatsAppAccount.updateMany({
    where: { id: accountId, workspaceId },
    data: {
      lastErrorMessage: error.lastErrorMessage,
      lastErrorCode: error.lastErrorCode ?? null,
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

/**
 * Writes back what a lifecycle step or a health check learned.
 *
 * `updateMany` with the workspace in the predicate rather than a read-then-write:
 * a row in another tenant matches nothing and updates nothing, so there is no window
 * in which the wrong account could be patched.
 */
export async function updateAccountConnectionState(
  db: Db,
  workspaceId: string,
  accountId: string,
  patch: AccountConnectionPatch,
): Promise<void> {
  await db.whatsAppAccount.updateMany({
    where: { id: accountId, workspaceId },
    data: {
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.subscribedAt !== undefined && { subscribedAt: patch.subscribedAt }),
      ...(patch.subscriptionVerifiedAt !== undefined && {
        subscriptionVerifiedAt: patch.subscriptionVerifiedAt,
      }),
      ...(patch.tokenExpiresAt !== undefined && { tokenExpiresAt: patch.tokenExpiresAt }),
      ...(patch.lastHealthCheckAt !== undefined && { lastHealthCheckAt: patch.lastHealthCheckAt }),
      ...(patch.lastErrorCode !== undefined && { lastErrorCode: patch.lastErrorCode }),
      ...(patch.lastErrorMessage !== undefined && { lastErrorMessage: patch.lastErrorMessage }),
      ...(patch.lastErrorAt !== undefined && { lastErrorAt: patch.lastErrorAt }),
    },
  });
}

/**
 * Records that a phone number completed Cloud API registration.
 *
 * The PIN is stored encrypted because re-registering the same number later requires
 * the same PIN, and asking a shop owner to remember a six-digit number we generated
 * for them is a support ticket waiting to happen.
 *
 * `registrationPinEncrypted` is nullable rather than required: a number Meta already had
 * on Cloud API keeps whatever PIN it was first registered with, and storing one we
 * invented would put a value on the row that Meta would reject.
 */
export async function markPhoneNumberRegistered(
  db: Db,
  workspaceId: string,
  phoneNumberRowId: string,
  data: { registrationPinEncrypted?: string | null; at?: Date },
): Promise<void> {
  await db.whatsAppPhoneNumber.updateMany({
    where: { id: phoneNumberRowId, workspaceId },
    data: {
      registeredAt: data.at ?? new Date(),
      ...(data.registrationPinEncrypted !== undefined && {
        registrationPinEncrypted: data.registrationPinEncrypted,
      }),
    },
  });
}

/**
 * Marks a real inbound webhook event against the account and the number it arrived on.
 *
 * This is one of the two facts a health indicator may honestly be built from, and it
 * is written on the webhook path — after the tenant has already been resolved from
 * `phone_number_id`, so `workspaceId` here comes from that resolved row and never
 * from the payload.
 */
export async function touchInboundActivity(
  db: Db,
  workspaceId: string,
  params: { accountId: string; phoneNumberRowId: string; at?: Date },
): Promise<void> {
  const at = params.at ?? new Date();
  // Two statements rather than a transaction. `Db` may already be a transaction
  // client, and these are activity timestamps: if the second one were ever lost, the
  // cost is a slightly stale number-level figure, not an inconsistent state.
  await db.whatsAppAccount.updateMany({
    where: { id: params.accountId, workspaceId },
    data: { lastInboundEventAt: at },
  });
  await db.whatsAppPhoneNumber.updateMany({
    where: { id: params.phoneNumberRowId, workspaceId },
    data: { lastInboundAt: at },
  });
}

/** The other honest fact: Meta accepted an outbound send from this number. */
export async function touchOutboundSuccess(
  db: Db,
  workspaceId: string,
  params: { accountId: string; phoneNumberRowId: string; at?: Date },
): Promise<void> {
  const at = params.at ?? new Date();
  await db.whatsAppAccount.updateMany({
    where: { id: params.accountId, workspaceId },
    data: { lastOutboundSuccessAt: at },
  });
  await db.whatsAppPhoneNumber.updateMany({
    where: { id: params.phoneNumberRowId, workspaceId },
    data: { lastOutboundAt: at },
  });
}

/**
 * Finds the account holding a WABA anywhere on the platform.
 *
 * CROSS-TENANT, and deliberately so: a WhatsApp Business Account belongs to exactly
 * one workspace, enforced by a unique index on `wabaId`. Checking here lets the
 * service refuse the claim with a clear message instead of surfacing a Prisma unique
 * violation, and it returns only the ids a caller needs to make that decision —
 * never the token.
 */
export async function findAccountOwnerByWabaId(
  db: Db,
  wabaId: string,
): Promise<{ id: string; workspaceId: string } | null> {
  return db.whatsAppAccount.findUnique({
    where: { wabaId },
    select: { id: true, workspaceId: true },
  });
}
