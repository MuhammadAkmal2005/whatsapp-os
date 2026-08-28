/**
 * Mock WhatsApp Provider.
 *
 * Implements WhatsAppProvider for local development and integration testing.
 * Simulates Meta Cloud API messaging responses without outbound network requests.
 */

import { randomUUID } from 'node:crypto';

import type {
  ProviderSendMediaParams,
  ProviderSendResult,
  ProviderSendTemplateParams,
  ProviderSendTextParams,
  WhatsAppProvider,
} from './provider.interface';

export type MockSentRecord = {
  id: string;
  type: 'TEXT' | 'MEDIA' | 'TEMPLATE';
  toPhone: string;
  params: ProviderSendTextParams | ProviderSendMediaParams | ProviderSendTemplateParams;
  result: ProviderSendResult;
  sentAt: Date;
};

export class MockWhatsAppProvider implements WhatsAppProvider {
  private sentLog: MockSentRecord[] = [];
  private readReceipts: string[] = [];

  async sendText(params: ProviderSendTextParams): Promise<ProviderSendResult> {
    const occurredAt = new Date();
    const providerMessageId = `wamid.mock_${Date.now()}_${randomUUID().replace(/-/g, '')}`;

    const result: ProviderSendResult = {
      providerMessageId,
      status: 'SENT',
      occurredAt,
    };

    this.sentLog.push({
      id: providerMessageId,
      type: 'TEXT',
      toPhone: params.toPhone,
      params,
      result,
      sentAt: occurredAt,
    });

    return result;
  }

  async sendMedia(params: ProviderSendMediaParams): Promise<ProviderSendResult> {
    const occurredAt = new Date();
    const providerMessageId = `wamid.mock_media_${Date.now()}_${randomUUID().replace(/-/g, '')}`;

    const result: ProviderSendResult = {
      providerMessageId,
      status: 'SENT',
      occurredAt,
    };

    this.sentLog.push({
      id: providerMessageId,
      type: 'MEDIA',
      toPhone: params.toPhone,
      params,
      result,
      sentAt: occurredAt,
    });

    return result;
  }

  async sendTemplate(params: ProviderSendTemplateParams): Promise<ProviderSendResult> {
    const occurredAt = new Date();
    const providerMessageId = `wamid.mock_tmpl_${Date.now()}_${randomUUID().replace(/-/g, '')}`;

    const result: ProviderSendResult = {
      providerMessageId,
      status: 'SENT',
      occurredAt,
    };

    this.sentLog.push({
      id: providerMessageId,
      type: 'TEMPLATE',
      toPhone: params.toPhone,
      params,
      result,
      sentAt: occurredAt,
    });

    return result;
  }

  async markRead(providerMessageId: string): Promise<void> {
    this.readReceipts.push(providerMessageId);
  }

  // ── Testing & Inspection Helpers ─────────────────────────────────────────

  getSentMessages(): readonly MockSentRecord[] {
    return [...this.sentLog];
  }

  getLastSent(): MockSentRecord | undefined {
    return this.sentLog[this.sentLog.length - 1];
  }

  getReadReceipts(): readonly string[] {
    return [...this.readReceipts];
  }

  clear(): void {
    this.sentLog = [];
    this.readReceipts = [];
  }
}
