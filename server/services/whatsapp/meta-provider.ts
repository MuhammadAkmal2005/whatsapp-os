/**
 * Meta WhatsApp Cloud API Provider.
 *
 * Implements WhatsAppProvider for official Meta WhatsApp Business Platform integration.
 * Communicates directly with Meta Graph API endpoints using constructor-injected credentials.
 */

import 'server-only';

import { env } from '@/config/env';
import { normalisePhone } from '@/lib/phone';
import {
  BusinessRuleError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from '@/server/errors';
import { transportFailure, type MetaGraphFailure } from './meta-failure';
import type {
  ProviderSendMediaParams,
  ProviderSendResult,
  ProviderSendTemplateParams,
  ProviderSendTextParams,
  WhatsAppProvider,
} from './provider.interface';

/**
 * How long we wait for Meta to answer a send.
 *
 * A send runs either inside a human's request or inside a job with a five-minute lock,
 * so an unbounded wait is a worker slot held hostage by one hung socket. Twenty seconds
 * is far beyond Meta's normal response time, which matters because *aborting* is not
 * free: an abort tells us nothing about whether Meta accepted the message, so every
 * timeout costs a message that has to be reported as uncertain rather than sent.
 */
const SEND_TIMEOUT_MS = 20_000;


export type MetaWhatsAppProviderConfig = {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: {
      details?: string;
    };
    fbtrace_id?: string;
  };
}

interface MetaSendMessageResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

interface MetaMarkReadResponse {
  success?: boolean;
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: MetaWhatsAppProviderConfig) {
    if (!config.phoneNumberId || typeof config.phoneNumberId !== 'string') {
      throw new ValidationError('Meta WhatsApp Provider requires a valid phoneNumberId');
    }
    if (!config.accessToken || typeof config.accessToken !== 'string') {
      throw new ValidationError('Meta WhatsApp Provider requires a valid accessToken');
    }

    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? env.WHATSAPP_API_VERSION ?? 'v21.0';
    this.baseUrl = config.baseUrl ?? 'https://graph.facebook.com';
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private get messagesUrl(): string {
    return `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  /**
   * Sends a POST request to Meta WhatsApp Graph API endpoint.
   *
   * Every throw carries a `MetaGraphFailure` as its cause, because the caller's next
   * decision — retry, give up, or record "we do not know" — turns entirely on whether
   * the request bytes could have reached Meta. An error that omits that fact forces the
   * caller to guess, and the safe guess is the expensive one.
   */
  private async postToMeta<T>(body: Record<string, unknown>): Promise<T> {
    const url = this.messagesUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (networkError) {
      const failure = transportFailure(networkError);
      throw new ProviderError(
        'whatsapp',
        `Failed to reach Meta WhatsApp Cloud API (${failure.transportCode ?? 'network error'}).`,
        failure,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    try {
      const data = (await response.json()) as T;
      return data;
    } catch (parseError) {
      // A 2xx we cannot read. Meta accepted the request; we simply lost the id.
      const failure: MetaGraphFailure = {
        kind: 'malformed',
        status: response.status,
        metaCode: null,
        metaSubcode: null,
        requestPossiblySent: true,
        transportCode: null,
      };
      throw new ProviderError(
        'whatsapp',
        `Malformed JSON response from Meta WhatsApp Cloud API: ${
          parseError instanceof Error ? parseError.message : 'unreadable body'
        }`,
        failure,
      );
    }
  }

  /**
   * Translates Meta HTTP/JSON error responses into domain-safe AppError subclasses.
   * Ensures access tokens and sensitive request payload data are redacted.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: MetaErrorResponse | null = null;
    try {
      errorData = (await response.json()) as MetaErrorResponse;
    } catch {
      // Body was not JSON
    }

    const metaError = errorData?.error;
    const errorCode = metaError?.code;
    const errorSubcode = metaError?.error_subcode;
    const rawMessage = metaError?.message || `HTTP ${response.status} ${response.statusText}`;
    const sanitizedMessage = this.sanitizeErrorMessage(rawMessage);

    const failure: MetaGraphFailure = {
      kind: 'http',
      status: response.status,
      metaCode: errorCode ?? null,
      metaSubcode: errorSubcode ?? null,
      // Meta answered, so it received the request. Whether it acted on it is only in
      // doubt when it failed on its own side.
      requestPossiblySent: response.status >= 500,
      transportCode: null,
    };

    // 1. Authentication / Authorization Failures
    if (response.status === 401 || response.status === 403 || errorCode === 190 || errorCode === 10) {
      throw new ProviderError('whatsapp', `WhatsApp authentication failed: ${sanitizedMessage}`, failure);
    }

    // 2. Rate Limiting
    if (response.status === 429 || errorCode === 80007 || errorCode === 130429 || errorCode === 131048) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
      throw new RateLimitError(
        isNaN(retryAfter) ? 60 : retryAfter,
        `WhatsApp rate limit exceeded: ${sanitizedMessage}`,
      );
    }

    // 3. 24-Hour Customer Service Window Violation
    if (errorCode === 131047) {
      throw new BusinessRuleError(
        'Cannot send standard message outside the 24-hour service window. Please send an approved template instead.',
      );
    }

    // 4. Validation / Invalid Parameter Errors
    if (response.status === 400 || response.status === 422 || errorCode === 100) {
      throw new ValidationError(`WhatsApp API validation error: ${sanitizedMessage}`);
    }

    // 5. Server / Upstream Errors (5xx)
    if (response.status >= 500) {
      throw new ProviderError(
        'whatsapp',
        `WhatsApp service temporarily unavailable (${response.status}): ${sanitizedMessage}`,
        failure,
      );
    }

    // 6. Generic Provider Error
    throw new ProviderError('whatsapp', `WhatsApp API error: ${sanitizedMessage}`, failure);
  }

  /**
   * Reads the id Meta assigned, or refuses to guess.
   *
   * A 2xx without an id is the worst-shaped answer we can get: Meta almost certainly
   * accepted the message, and we have nothing to correlate the delivery callback
   * against. It is reported as `malformed` so the send path records it as uncertain
   * rather than retrying it into a duplicate.
   */
  private extractMessageId(data: MetaSendMessageResponse): string {
    const providerMessageId = data.messages?.[0]?.id;
    if (providerMessageId && typeof providerMessageId === 'string') return providerMessageId;

    const failure: MetaGraphFailure = {
      kind: 'malformed',
      status: 200,
      metaCode: null,
      metaSubcode: null,
      requestPossiblySent: true,
      transportCode: null,
    };
    throw new ProviderError(
      'whatsapp',
      'Meta accepted the request but returned no message id.',
      failure,
    );
  }

  /**
   * Redacts live credentials if Meta error payload reflects them back.
   */
  private sanitizeErrorMessage(message: string): string {
    if (!this.accessToken) return message;
    return message.split(this.accessToken).join('[REDACTED_ACCESS_TOKEN]');
  }

  /**
   * Normalizes customer phone number to digits-only format required by Meta Cloud API.
   */
  private formatRecipient(toPhone: string): string {
    const normalised = normalisePhone(toPhone);
    if (normalised) {
      return normalised.waId;
    }
    const digits = toPhone.replace(/\D/g, '');
    if (!digits) {
      throw new ValidationError(`Invalid recipient phone number: ${toPhone}`);
    }
    return digits;
  }

  async sendText(params: ProviderSendTextParams): Promise<ProviderSendResult> {
    const recipient = this.formatRecipient(params.toPhone);
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        preview_url: false,
        body: params.body,
      },
    };

    if (params.replyToProviderMessageId) {
      body.context = {
        message_id: params.replyToProviderMessageId,
      };
    }

    const data = await this.postToMeta<MetaSendMessageResponse>(body);
    const providerMessageId = this.extractMessageId(data);

    return {
      providerMessageId,
      status: 'SENT',
      occurredAt: new Date(),
    };
  }

  async sendMedia(params: ProviderSendMediaParams): Promise<ProviderSendResult> {
    const recipient = this.formatRecipient(params.toPhone);
    const kindMap: Record<ProviderSendMediaParams['kind'], 'image' | 'document' | 'audio' | 'video'> = {
      IMAGE: 'image',
      DOCUMENT: 'document',
      AUDIO: 'audio',
      VIDEO: 'video',
    };

    const mediaType = kindMap[params.kind];
    const mediaObject: Record<string, unknown> = {
      link: params.mediaUrl,
    };

    if (params.caption) {
      mediaObject.caption = params.caption;
    }
    if (params.fileName && mediaType === 'document') {
      mediaObject.filename = params.fileName;
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: mediaType,
      [mediaType]: mediaObject,
    };

    const data = await this.postToMeta<MetaSendMessageResponse>(body);
    const providerMessageId = this.extractMessageId(data);

    return {
      providerMessageId,
      status: 'SENT',
      occurredAt: new Date(),
    };
  }

  async sendTemplate(params: ProviderSendTemplateParams): Promise<ProviderSendResult> {
    const recipient = this.formatRecipient(params.toPhone);
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: params.templateName,
        language: {
          code: params.language,
        },
        ...(params.components && params.components.length > 0 ? { components: params.components } : {}),
      },
    };

    const data = await this.postToMeta<MetaSendMessageResponse>(body);
    const providerMessageId = this.extractMessageId(data);

    return {
      providerMessageId,
      status: 'SENT',
      occurredAt: new Date(),
    };
  }

  async markRead(providerMessageId: string): Promise<void> {
    if (!providerMessageId) return;

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: providerMessageId,
    };

    await this.postToMeta<MetaMarkReadResponse>(body);
  }
}
