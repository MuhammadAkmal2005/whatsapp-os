/**
 * WhatsApp Provider Abstraction.
 *
 * Defines the channel boundary for outbound sends and inbound webhooks.
 * Exposes normalized DTOs (not Prisma models) to ensure domain services remain
 * decoupled from specific Meta Graph API or Mock implementations.
 */

import type { MessageType } from '@/server/validation/conversation';

export type ProviderSendTextParams = {
  toPhone: string;
  body: string;
  replyToProviderMessageId?: string;
};

export type ProviderSendMediaParams = {
  toPhone: string;
  mediaUrl: string;
  kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
  caption?: string;
  fileName?: string;
};

export type ProviderSendTemplateParams = {
  toPhone: string;
  templateName: string;
  language: string;
  components?: unknown[];
};

export type ProviderSendResult = {
  providerMessageId: string;
  status: 'QUEUED' | 'SENDING' | 'SENT';
  occurredAt: Date;
};

export type InboundTextMessage = {
  type: 'TEXT';
  providerMessageId: string;
  fromPhone: string;
  waProfileName?: string | null;
  body: string;
  occurredAt: Date;
  replyToProviderMessageId?: string | null;
};

export type InboundMediaMessage = {
  type: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
  providerMessageId: string;
  fromPhone: string;
  waProfileName?: string | null;
  mediaUrl?: string | null;
  mimeType?: string;
  fileName?: string | null;
  caption?: string | null;
  occurredAt: Date;
  replyToProviderMessageId?: string | null;
};

export type InboundStatusUpdate = {
  type: 'STATUS';
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  occurredAt: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ProviderInboundEvent = InboundTextMessage | InboundMediaMessage | InboundStatusUpdate;

export interface WhatsAppProvider {
  /** Send a plain text message to a customer's WhatsApp number. */
  sendText(params: ProviderSendTextParams): Promise<ProviderSendResult>;

  /** Send media (image, document, audio, video) to a customer. */
  sendMedia(params: ProviderSendMediaParams): Promise<ProviderSendResult>;

  /** Send an approved template message outside the 24-hour service window. */
  sendTemplate(params: ProviderSendTemplateParams): Promise<ProviderSendResult>;

  /** Mark an inbound customer message as read on WhatsApp. */
  markRead(providerMessageId: string): Promise<void>;
}
