/**
 * WhatsApp Business Account management.
 *
 * Read side and lifecycle. The work of establishing a connection lives in
 * `meta-onboarding.service.ts`, which both this manual-token path and the Embedded Signup
 * path run through — so a number connected by pasting a System User token is verified
 * exactly as strictly as one connected through Meta's dialog.
 *
 * The DTO is the other half of this file's job. Everything it exposes is safe to render:
 * Meta's own identifiers, our lifecycle timestamps, and the words we chose for a status.
 * The encrypted token and the encrypted registration PIN are not on the row type the
 * repository returns, so there is no field here that could accidentally carry one to a
 * React prop.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { NotFoundError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  disconnectWhatsAppAccount as repoDisconnectAccount,
  findAccountById,
  findAccountsWithPhoneNumbers,
  type ChannelStatus,
  type MetaConnectionMethod,
  type WhatsAppAccountWithPhoneNumbersRow,
} from '@/server/repositories/whatsapp-account.repository';
import { MetaGraphClient } from '@/server/services/whatsapp/meta-graph.client';
import {
  establishMetaConnection,
  type ConnectionWarning,
} from '@/server/services/whatsapp/meta-onboarding.service';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type { ConnectWhatsAppInput } from '@/server/validation/whatsapp-account';

export type WhatsAppPhoneNumberOverviewDTO = {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  /** Meta's phone-verification state, e.g. VERIFIED. */
  codeVerificationStatus: string | null;
  /** CLOUD_API once the number can send through the Cloud API. */
  platformType: string | null;
  throughputLevel: string | null;
  status: ChannelStatus;
  isDefault: boolean;
  registeredAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
};

export type WhatsAppAccountOverviewDTO = {
  id: string;
  wabaId: string;
  metaBusinessId: string | null;
  displayName: string | null;
  status: ChannelStatus;
  connectionMethod: MetaConnectionMethod;
  isMock: boolean;
  connectedAt: Date | null;
  /** Null for a non-expiring System User token, or when Meta would not tell us. */
  tokenExpiresAt: Date | null;
  tokenUpdatedAt: Date | null;
  /** When Meta accepted our subscription request for this WABA. */
  subscribedAt: Date | null;
  /** When a read of the subscription edge last confirmed it. The honest one. */
  subscriptionVerifiedAt: Date | null;
  lastInboundEventAt: Date | null;
  lastOutboundSuccessAt: Date | null;
  lastHealthCheckAt: Date | null;
  disconnectedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  phoneNumbers: WhatsAppPhoneNumberOverviewDTO[];
};

export function mapToOverviewDTO(
  account: WhatsAppAccountWithPhoneNumbersRow,
): WhatsAppAccountOverviewDTO {
  return {
    id: account.id,
    wabaId: account.wabaId,
    metaBusinessId: account.metaBusinessId,
    displayName: account.displayName,
    status: account.status,
    connectionMethod: account.connectionMethod,
    isMock: account.isMock,
    connectedAt: account.connectedAt,
    tokenExpiresAt: account.tokenExpiresAt,
    tokenUpdatedAt: account.tokenUpdatedAt,
    subscribedAt: account.subscribedAt,
    subscriptionVerifiedAt: account.subscriptionVerifiedAt,
    lastInboundEventAt: account.lastInboundEventAt,
    lastOutboundSuccessAt: account.lastOutboundSuccessAt,
    lastHealthCheckAt: account.lastHealthCheckAt,
    disconnectedAt: account.disconnectedAt,
    lastErrorAt: account.lastErrorAt,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    phoneNumbers: account.phoneNumbers.map((phone) => ({
      id: phone.id,
      phoneNumberId: phone.phoneNumberId,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName,
      qualityRating: phone.qualityRating,
      codeVerificationStatus: phone.codeVerificationStatus,
      platformType: phone.platformType,
      throughputLevel: phone.throughputLevel,
      status: phone.status,
      isDefault: phone.isDefault,
      registeredAt: phone.registeredAt,
      lastInboundAt: phone.lastInboundAt,
      lastOutboundAt: phone.lastOutboundAt,
    })),
  };
}

/** The workspace's WhatsApp connections, including disconnected ones, newest first. */
export async function getWhatsAppAccountOverview(
  ctx: TenantContext,
): Promise<WhatsAppAccountOverviewDTO[]> {
  requirePermission(ctx, 'whatsapp:read');

  const accounts = await findAccountsWithPhoneNumbers(prisma, ctx.workspaceId);
  return accounts.map(mapToOverviewDTO);
}

export type ConnectWhatsAppAccountOptions = {
  /** Test seam. Production passes nothing, and the Graph client uses global `fetch`. */
  fetchFn?: typeof fetch;
  forceMock?: boolean;
};

export type ConnectWhatsAppAccountResult = WhatsAppAccountOverviewDTO & {
  /** Problems that did not stop the connection but that the owner needs to see. */
  warnings: readonly ConnectionWarning[];
};

/**
 * Connects or updates a WhatsApp Business Account from a manually supplied token.
 *
 * The token is a System User token from the business's own Business Manager. Nothing about
 * the input is trusted beyond being well-formed: the WABA is read back with the token and
 * the phone number must be one Meta lists against it, so the ids in `input` are treated as
 * a request, not a fact.
 */
export async function connectWhatsAppAccount(
  ctx: TenantContext,
  input: ConnectWhatsAppInput,
  options?: ConnectWhatsAppAccountOptions,
): Promise<ConnectWhatsAppAccountResult> {
  const result = await establishMetaConnection(ctx, {
    method: 'MANUAL_TOKEN',
    accessToken: input.accessToken,
    // A System User token does not expire unless the business set an expiry, and Meta does
    // not report one on the token itself; `debug_token` fills this in when it can.
    tokenType: 'SYSTEM_USER',
    tokenExpiresAt: null,
    claimedWabaId: input.wabaId,
    claimedPhoneNumberId: input.phoneNumberId,
    preferredDisplayName: input.displayName ?? null,
    fallbackDisplayPhoneNumber: input.displayPhoneNumber,
    graph: options?.fetchFn ? new MetaGraphClient({ fetchFn: options.fetchFn }) : undefined,
    forceMock: options?.forceMock,
  });

  return { ...mapToOverviewDTO(result.account), warnings: result.warnings };
}

/**
 * Releases a number back to the business.
 *
 * The account row survives on purpose: conversations, contacts, orders and messages point
 * at it, and that history is the business's. What is destroyed is the ability to act —
 * the token, the token metadata, the subscription timestamps and the registration PIN.
 *
 * Meta is not asked to unsubscribe. The business may be moving the number to another tool
 * or reconnecting here in a minute, and tearing down their subscription on their behalf is
 * a change to their Meta account that they did not ask us to make. What we control is
 * whether *we* can still use it, and after this we cannot.
 */
export async function disconnectWhatsAppAccount(
  ctx: TenantContext,
  accountId: string,
): Promise<void> {
  requirePermission(ctx, 'whatsapp:disconnect');

  const workspaceId = ctx.workspaceId;
  const account = await findAccountById(prisma, workspaceId, accountId);
  if (!account) {
    throw new NotFoundError(`WhatsAppAccount with id "${accountId}"`);
  }

  await repoDisconnectAccount(prisma, workspaceId, accountId, {
    memberId: ctx.membershipId,
  });

  await appendAuditLog(prisma, {
    action: 'whatsapp.account.disconnected',
    workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    resourceType: 'WhatsAppAccount',
    resourceId: accountId,
    metadata: {
      wabaId: account.wabaId,
      connectionMethod: account.connectionMethod,
      // Recorded so an audit trail shows how long the number was live, not just that it
      // was removed.
      connectedAt: account.connectedAt?.toISOString() ?? null,
    },
  });

  logger.info('whatsapp.account.disconnected', {
    workspaceId,
    accountId,
    wabaId: account.wabaId,
  });
}
