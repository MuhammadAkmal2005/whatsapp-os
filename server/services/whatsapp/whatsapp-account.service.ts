/**
 * WhatsApp Business Account Management Service.
 *
 * Handles workspace-scoped WhatsApp Business Account and Phone Number connections,
 * credential validation, zero-trust token encryption, and disconnection.
 */

import 'server-only';

import { env, isWhatsAppMocked } from '@/config/env';
import { prisma } from '@/db/prisma';
import { encryptSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { NotFoundError, ValidationError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  disconnectWhatsAppAccount as repoDisconnectAccount,
  findAccountById,
  findAccountsWithPhoneNumbers,
  findPhoneNumberWithAccountByPhoneNumberId,
  upsertWhatsAppAccountWithPhoneNumber,
  type ChannelStatus,
  type WhatsAppAccountWithPhoneNumbersRow,
} from '@/server/repositories/whatsapp-account.repository';
import { assertWithinPlanLimit } from '@/server/services/billing/limit-guard.service';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type { ConnectWhatsAppInput } from '@/server/validation/whatsapp-account';

export type WhatsAppAccountOverviewDTO = {
  id: string;
  wabaId: string;
  displayName: string | null;
  status: ChannelStatus;
  isMock: boolean;
  connectedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  phoneNumbers: Array<{
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    qualityRating: string | null;
    status: ChannelStatus;
    isDefault: boolean;
  }>;
};

export type ValidateMetaCredentialsOptions = {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

export type MetaPhoneNumberVerificationResult = {
  verifiedName?: string | null;
  displayPhoneNumber?: string | null;
  qualityRating?: string | null;
};

/**
 * Validates Meta WhatsApp credentials against Meta Graph API.
 * Never logs or reflects the access token in errors.
 */
export async function validateMetaCredentials(
  options: ValidateMetaCredentialsOptions,
): Promise<MetaPhoneNumberVerificationResult> {
  const apiVersion = options.apiVersion ?? env.WHATSAPP_API_VERSION ?? 'v21.0';
  const baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
  const fetchFn = options.fetchFn ?? fetch;
  const url = `${baseUrl}/${apiVersion}/${encodeURIComponent(options.phoneNumberId)}?fields=verified_name,display_phone_number,quality_rating`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    throw new ValidationError(`Failed to connect to Meta WhatsApp API for verification: ${msg}`);
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = (await response.json()) as { error?: { message?: string; code?: number } };
      if (errJson?.error?.message) {
        // Redact any potential token reflection
        errorDetail = errJson.error.message.split(options.accessToken).join('[REDACTED]');
      }
    } catch {
      // Body not JSON
    }

    const safeMessage = errorDetail
      ? `Meta credential verification failed (${response.status}): ${errorDetail}`
      : `Meta credential verification failed with HTTP status ${response.status}. Please check your Access Token and Phone Number ID.`;

    throw new ValidationError(safeMessage);
  }

  try {
    const data = (await response.json()) as {
      verified_name?: string;
      display_phone_number?: string;
      quality_rating?: string;
    };

    return {
      verifiedName: data.verified_name ?? null,
      displayPhoneNumber: data.display_phone_number ?? null,
      qualityRating: data.quality_rating ?? null,
    };
  } catch {
    throw new ValidationError('Invalid response received from Meta WhatsApp API during verification.');
  }
}

function mapToOverviewDTO(account: WhatsAppAccountWithPhoneNumbersRow): WhatsAppAccountOverviewDTO {
  return {
    id: account.id,
    wabaId: account.wabaId,
    displayName: account.displayName,
    status: account.status,
    isMock: account.isMock,
    connectedAt: account.connectedAt,
    lastErrorAt: account.lastErrorAt,
    lastErrorMessage: account.lastErrorMessage,
    phoneNumbers: account.phoneNumbers.map((phone) => ({
      id: phone.id,
      phoneNumberId: phone.phoneNumberId,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName,
      qualityRating: phone.qualityRating,
      status: phone.status,
      isDefault: phone.isDefault,
    })),
  };
}

/**
 * Returns the current WhatsApp Business Account configuration and phone numbers for the workspace.
 */
export async function getWhatsAppAccountOverview(
  ctx: TenantContext,
): Promise<WhatsAppAccountOverviewDTO[]> {
  requirePermission(ctx, 'whatsapp:read');

  const accounts = await findAccountsWithPhoneNumbers(prisma, ctx.workspaceId);
  return accounts.map(mapToOverviewDTO);
}

export type ConnectWhatsAppAccountOptions = {
  fetchFn?: typeof fetch;
  forceMock?: boolean;
};

/**
 * Connects or updates a WhatsApp Business Account and its primary phone number.
 * Validates Meta credentials, encrypts the access token, enforces cross-tenant uniqueness,
 * and records an audit log entry.
 */
export async function connectWhatsAppAccount(
  ctx: TenantContext,
  input: ConnectWhatsAppInput,
  options?: ConnectWhatsAppAccountOptions,
): Promise<WhatsAppAccountOverviewDTO> {
  requirePermission(ctx, 'whatsapp:connect');

  const workspaceId = ctx.workspaceId;

  // 1. Cross-tenant isolation check: Ensure phone number is not claimed by another workspace
  const existingPhone = await findPhoneNumberWithAccountByPhoneNumberId(
    prisma,
    input.phoneNumberId,
  );

  if (existingPhone && existingPhone.workspaceId !== workspaceId) {
    throw new ValidationError(
      'This WhatsApp phone number is already connected to another workspace. Disconnect it there first.',
    );
  }

  const isMock = options?.forceMock ?? isWhatsAppMocked;
  let verifiedName = input.displayName ?? null;
  let qualityRating: string | null = null;
  let displayPhoneNumber = input.displayPhoneNumber;

  // 2. Live Meta credential validation
  if (!isMock) {
    const metaDetails = await validateMetaCredentials({
      phoneNumberId: input.phoneNumberId,
      accessToken: input.accessToken,
      fetchFn: options?.fetchFn,
    });

    if (metaDetails.verifiedName) {
      verifiedName = metaDetails.verifiedName;
    }
    if (metaDetails.qualityRating) {
      qualityRating = metaDetails.qualityRating;
    }
    if (metaDetails.displayPhoneNumber) {
      displayPhoneNumber = metaDetails.displayPhoneNumber;
    }
  }

  // 3. Encrypt access token at rest
  const accessTokenEncrypted = encryptSecret(input.accessToken, env.AUTH_SECRET);

  // 4. Atomic upsert
  const isUpdate = Boolean(existingPhone && existingPhone.workspaceId === workspaceId);
  if (!isUpdate) {
    await assertWithinPlanLimit(ctx, 'whatsappNumbers', 1);
  }

  const account = await upsertWhatsAppAccountWithPhoneNumber(prisma, workspaceId, {
    wabaId: input.wabaId,
    displayName: input.displayName ?? verifiedName ?? null,
    accessTokenEncrypted,
    status: 'CONNECTED',
    isMock,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber,
    verifiedName,
    qualityRating,
    isDefault: true,
  });

  // 5. Append audit log (never including the access token)
  await appendAuditLog(prisma, {
    action: isUpdate ? 'whatsapp.account.updated' : 'whatsapp.account.connected',
    workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    resourceType: 'WhatsAppAccount',
    resourceId: account.id,
    metadata: {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber,
      isMock,
    },
  });

  logger.info('whatsapp.account.connected', {
    workspaceId,
    accountId: account.id,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    isMock,
  });

  return mapToOverviewDTO(account);
}

/**
 * Disconnects a WhatsApp Business Account, clearing stored tokens and updating statuses.
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

  await repoDisconnectAccount(prisma, workspaceId, accountId);

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
    },
  });

  logger.info('whatsapp.account.disconnected', {
    workspaceId,
    accountId,
    wabaId: account.wabaId,
  });
}
