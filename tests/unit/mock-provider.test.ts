import { describe, expect, it } from 'vitest';

import { MockWhatsAppProvider } from '@/server/services/whatsapp/mock-provider';
import {
  getMockWhatsAppProvider,
  getWhatsAppProvider,
  resetMockWhatsAppProvider,
} from '@/server/services/whatsapp/provider.factory';

describe('Mock WhatsApp Provider Unit Tests', () => {
  it('records outbound text messages and returns valid providerMessageId', async () => {
    const provider = new MockWhatsAppProvider();

    const result = await provider.sendText({
      toPhone: '+923001234567',
      body: 'Test text message',
    });

    expect(result.providerMessageId).toMatch(/^wamid\.mock_/);
    expect(result.status).toBe('SENT');
    expect(result.occurredAt).toBeInstanceOf(Date);

    const sent = provider.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.toPhone).toBe('+923001234567');
    expect(sent[0]?.type).toBe('TEXT');
  });

  it('records media and template sends with distinct prefixes', async () => {
    const provider = new MockWhatsAppProvider();

    const mediaResult = await provider.sendMedia({
      toPhone: '+923001234567',
      mediaUrl: 'https://example.com/receipt.pdf',
      kind: 'DOCUMENT',
      fileName: 'receipt.pdf',
    });

    expect(mediaResult.providerMessageId).toMatch(/^wamid\.mock_media_/);

    const templateResult = await provider.sendTemplate({
      toPhone: '+923001234567',
      templateName: 'order_confirmation',
      language: 'en',
    });

    expect(templateResult.providerMessageId).toMatch(/^wamid\.mock_tmpl_/);
    expect(provider.getSentMessages()).toHaveLength(2);
  });

  it('tracks read receipts and supports clearing', async () => {
    const provider = new MockWhatsAppProvider();

    await provider.markRead('wamid.mock_123');
    await provider.markRead('wamid.mock_456');

    expect(provider.getReadReceipts()).toEqual(['wamid.mock_123', 'wamid.mock_456']);

    provider.clear();
    expect(provider.getReadReceipts()).toHaveLength(0);
    expect(provider.getSentMessages()).toHaveLength(0);
  });

  it('factory returns singleton and resets cleanly', () => {
    resetMockWhatsAppProvider();
    const p1 = getWhatsAppProvider();
    const p2 = getMockWhatsAppProvider();

    expect(p1).toBe(p2);
  });
});
