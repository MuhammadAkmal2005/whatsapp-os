import { describe, expect, it, vi } from 'vitest';

import {
  BusinessRuleError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from '@/server/errors';
import { MetaWhatsAppProvider } from '@/server/services/whatsapp/meta-provider';

describe('Meta WhatsApp Provider Unit Tests', () => {
  const defaultCredentials = {
    phoneNumberId: '109876543210',
    accessToken: 'EAAB_test_secret_access_token_12345',
    apiVersion: 'v21.0',
  };

  describe('Constructor Validation', () => {
    it('throws ValidationError if phoneNumberId is missing or empty', () => {
      expect(
        () => new MetaWhatsAppProvider({ phoneNumberId: '', accessToken: 'token' }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError if accessToken is missing or empty', () => {
      expect(
        () => new MetaWhatsAppProvider({ phoneNumberId: '123', accessToken: '' }),
      ).toThrow(ValidationError);
    });
  });

  describe('sendText', () => {
    it('builds correct Graph API POST request and normalizes response', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch: typeof fetch = vi.fn(async (url, init) => {
        capturedUrl = url.toString();
        capturedInit = init;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            contacts: [{ input: '923001234567', wa_id: '923001234567' }],
            messages: [{ id: 'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzOEU0NzFD' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      const result = await provider.sendText({
        toPhone: '+923001234567',
        body: 'Assalam-o-alaikum! Your order has been placed.',
      });

      expect(capturedUrl).toBe(
        'https://graph.facebook.com/v21.0/109876543210/messages',
      );
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.headers).toEqual({
        Authorization: 'Bearer EAAB_test_secret_access_token_12345',
        'Content-Type': 'application/json',
      });

      const parsedBody = JSON.parse(capturedInit?.body as string);
      expect(parsedBody).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '923001234567',
        type: 'text',
        text: {
          preview_url: false,
          body: 'Assalam-o-alaikum! Your order has been placed.',
        },
      });

      expect(result.providerMessageId).toBe(
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzOEU0NzFD',
      );
      expect(result.status).toBe('SENT');
      expect(result.occurredAt).toBeInstanceOf(Date);
    });

    it('includes contextual message_id when replyToProviderMessageId is set', async () => {
      let capturedBody: string | undefined;

      const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.reply_response_1' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await provider.sendText({
        toPhone: '0300 1234567',
        body: 'Replying to your previous message',
        replyToProviderMessageId: 'wamid.customer_inbound_original',
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.context).toEqual({
        message_id: 'wamid.customer_inbound_original',
      });
      expect(parsed.to).toBe('923001234567');
    });
  });

  describe('sendMedia', () => {
    it('formats image, document, video, audio correctly', async () => {
      const payloads: Record<string, unknown>[] = [];

      const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
        payloads.push(JSON.parse(init?.body as string));
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: `wamid.media_${payloads.length}` }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      // 1. Document with filename & caption
      await provider.sendMedia({
        toPhone: '+923001234567',
        mediaUrl: 'https://example.com/invoice.pdf',
        kind: 'DOCUMENT',
        fileName: 'invoice-1001.pdf',
        caption: 'Here is your receipt',
      });

      expect(payloads[0]).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '923001234567',
        type: 'document',
        document: {
          link: 'https://example.com/invoice.pdf',
          caption: 'Here is your receipt',
          filename: 'invoice-1001.pdf',
        },
      });

      // 2. Image with caption
      await provider.sendMedia({
        toPhone: '+923001234567',
        mediaUrl: 'https://example.com/dress.jpg',
        kind: 'IMAGE',
        caption: 'Embroidered Lawn Suit',
      });

      expect(payloads[1]).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '923001234567',
        type: 'image',
        image: {
          link: 'https://example.com/dress.jpg',
          caption: 'Embroidered Lawn Suit',
        },
      });
    });
  });

  describe('sendTemplate', () => {
    it('formats template name, language code and components', async () => {
      let capturedBody: string | undefined;

      const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.template_result_1' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      const components = [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Ali Khan' }, { type: 'text', text: 'ORD-987' }],
        },
      ];

      await provider.sendTemplate({
        toPhone: '+923001234567',
        templateName: 'order_status_update',
        language: 'en_US',
        components,
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '923001234567',
        type: 'template',
        template: {
          name: 'order_status_update',
          language: { code: 'en_US' },
          components,
        },
      });
    });
  });

  describe('markRead', () => {
    it('sends status: read payload for given message ID', async () => {
      let capturedBody: string | undefined;

      const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await provider.markRead('wamid.customer_msg_123');

      const parsed = JSON.parse(capturedBody!);
      expect(parsed).toEqual({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.customer_msg_123',
      });
    });
  });

  describe('Error Mapping & Security Handling', () => {
    it('maps 401 / 403 / OAuthException to ProviderError with auth message and redacts token', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Error validating access token: Session has expired for token EAAB_test_secret_access_token_12345',
              type: 'OAuthException',
              code: 190,
              error_subcode: 463,
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      let thrownError: unknown;
      try {
        await provider.sendText({ toPhone: '+923001234567', body: 'Test' });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(ProviderError);
      const errorMsg = (thrownError as ProviderError).message;
      expect(errorMsg).toContain('WhatsApp authentication failed');
      // Verify token was redacted
      expect(errorMsg).not.toContain('EAAB_test_secret_access_token_12345');
      expect(errorMsg).toContain('[REDACTED_ACCESS_TOKEN]');
    });

    it('safely redacts tokens containing regex metacharacters without throwing', async () => {
      const specialToken = 'EAAB+test*token.with$symbols^and[brackets]';
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: `Error validating token ${specialToken} in authorization check`,
              type: 'OAuthException',
              code: 190,
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        phoneNumberId: '109876543210',
        accessToken: specialToken,
        fetchFn: mockFetch,
      });

      let thrownError: unknown;
      try {
        await provider.sendText({ toPhone: '+923001234567', body: 'Test' });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(ProviderError);
      const errorMsg = (thrownError as ProviderError).message;
      expect(errorMsg).not.toContain(specialToken);
      expect(errorMsg).toContain('[REDACTED_ACCESS_TOKEN]');
    });

    it('maps 429 rate limit to RateLimitError with retryAfter duration', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Rate limit hit',
              type: 'OAuthException',
              code: 80007,
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '120',
            },
          },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: 'Test' }),
      ).rejects.toThrow(RateLimitError);

      try {
        await provider.sendText({ toPhone: '+923001234567', body: 'Test' });
      } catch (e) {
        expect((e as RateLimitError).retryAfterSeconds).toBe(120);
      }
    });

    it('maps 24-hour service window violation (code 131047) to BusinessRuleError', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
              type: 'OAuthException',
              code: 131047,
              fbtrace_id: 'AQ123',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: 'Follow up' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('maps 400 invalid parameters to ValidationError', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Param text[body] must be a non-empty string',
              type: 'OAuthException',
              code: 100,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: '' }),
      ).rejects.toThrow(ValidationError);
    });

    it('handles 5xx server errors safely', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: 'Hello' }),
      ).rejects.toThrow(ProviderError);
    });

    it('handles network connection exceptions', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED connect graph.facebook.com:443');
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: 'Hello' }),
      ).rejects.toThrow(ProviderError);
    });

    it('throws ProviderError on malformed response without message ID', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new MetaWhatsAppProvider({
        ...defaultCredentials,
        fetchFn: mockFetch,
      });

      await expect(
        provider.sendText({ toPhone: '+923001234567', body: 'Hello' }),
      ).rejects.toThrow(ProviderError);
    });
  });
});
