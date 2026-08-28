/**
 * WhatsApp Provider Factory.
 *
 * Resolves the active WhatsAppProvider implementation based on runtime configuration.
 * Defaults to MockWhatsAppProvider when MOCK_WHATSAPP=true or in test environments.
 */

import { MockWhatsAppProvider } from './mock-provider';
import type { WhatsAppProvider } from './provider.interface';

let currentMockProvider: MockWhatsAppProvider | null = null;

export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  if (!currentMockProvider) {
    currentMockProvider = new MockWhatsAppProvider();
  }
  return currentMockProvider;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  // Mock mode is the default and only implementation in Phase 3
  return getMockWhatsAppProvider();
}

/** Test utility to reset mock state between tests */
export function resetMockWhatsAppProvider(): void {
  if (currentMockProvider) {
    currentMockProvider.clear();
  }
}
