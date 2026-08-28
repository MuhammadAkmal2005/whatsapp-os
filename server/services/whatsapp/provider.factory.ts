/**
 * WhatsApp Provider Factory.
 *
 * Resolves the active WhatsAppProvider implementation based on runtime configuration
 * and workspace credentials.
 * Defaults to MockWhatsAppProvider when MOCK_WHATSAPP=true or in test environments.
 */

import { env, isWhatsAppMocked } from '@/config/env';
import { prisma } from '@/db/prisma';
import { decryptSecret } from '@/lib/crypto';
import { NotConfiguredError } from '@/server/errors';
import {
  findDefaultPhoneNumberWithAccount,
  findPhoneNumberById,
} from '@/server/repositories/whatsapp-account.repository';
import { MetaWhatsAppProvider } from './meta-provider';
import { MockWhatsAppProvider } from './mock-provider';
import type { WhatsAppProvider } from './provider.interface';

let currentMockProvider: MockWhatsAppProvider | null = null;

export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  if (!currentMockProvider) {
    currentMockProvider = new MockWhatsAppProvider();
  }
  return currentMockProvider;
}

export type GetWhatsAppProviderOptions = {
  workspaceId?: string;
  phoneRecordId?: string | null;
  /** Test seam to force resolving MetaWhatsAppProvider even when MOCK_WHATSAPP=true */
  forceMeta?: boolean;
  /** Test seam to inject custom mock fetch into MetaWhatsAppProvider */
  fetchFn?: typeof fetch;
};

/**
 * Resolves the WhatsAppProvider for the given context.
 *
 * In mock mode: returns the MockWhatsAppProvider singleton.
 * In real mode: resolves workspace-owned WhatsApp credentials from the database and constructs MetaWhatsAppProvider.
 */
export async function getWhatsAppProvider(
  options?: GetWhatsAppProviderOptions,
): Promise<WhatsAppProvider> {
  // If mock mode is active and not forced to Meta, return mock provider
  if (isWhatsAppMocked && !options?.forceMeta) {
    return getMockWhatsAppProvider();
  }

  // Real WhatsApp mode requires a workspace context with an active database account
  if (!options?.workspaceId) {
    throw new NotConfiguredError(
      'WhatsApp Account',
      'No workspace context provided for WhatsApp message dispatch.',
    );
  }

  let phoneRecord = null;
  if (options.phoneRecordId) {
    phoneRecord = await findPhoneNumberById(prisma, options.workspaceId, options.phoneRecordId);
  }
  if (!phoneRecord) {
    phoneRecord = await findDefaultPhoneNumberWithAccount(prisma, options.workspaceId);
  }

  if (phoneRecord && phoneRecord.account.accessTokenEncrypted) {
    const accessToken = decryptSecret(phoneRecord.account.accessTokenEncrypted, env.AUTH_SECRET);
    return new MetaWhatsAppProvider({
      phoneNumberId: phoneRecord.phoneNumberId,
      accessToken,
      apiVersion: env.WHATSAPP_API_VERSION,
      fetchFn: options?.fetchFn,
    });
  }

  throw new NotConfiguredError(
    'WhatsApp Account',
    'No connected WhatsApp Business Account found for this workspace. Connect WhatsApp in Settings to send messages.',
  );
}

/** Test utility to reset mock state between tests */
export function resetMockWhatsAppProvider(): void {
  if (currentMockProvider) {
    currentMockProvider.clear();
  }
}
