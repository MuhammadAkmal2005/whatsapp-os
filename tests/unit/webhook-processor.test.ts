import { describe, expect, it } from 'vitest';

import { parseLogicalEventToDomain } from '@/server/services/whatsapp/webhook-processor.service';

describe('parseLogicalEventToDomain', () => {
  it('parses valid inbound text message payload', () => {
    const payload = {
      id: 'wamid.HBgL123456789',
      from: '923001234567',
      timestamp: '1724800000',
      type: 'text',
      text: { body: 'Hello world!' },
      context: { id: 'wamid.previous' },
      contacts: [{ profile: { name: 'Ali Khan' }, wa_id: '923001234567' }],
    };

    const result = parseLogicalEventToDomain('message', payload);

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('message');
    if (result?.kind === 'message') {
      expect(result.message.type).toBe('TEXT');
      expect(result.message.providerMessageId).toBe('wamid.HBgL123456789');
      expect(result.message.fromPhone).toBe('+923001234567');
      expect(result.message.waProfileName).toBe('Ali Khan');
      expect(result.message.replyToProviderMessageId).toBe('wamid.previous');
      if (result.message.type === 'TEXT') {
        expect(result.message.body).toBe('Hello world!');
      }
    }
  });

  it('parses valid inbound media message payload (image)', () => {
    const payload = {
      id: 'wamid.HBgL987654321',
      from: '923007654321',
      timestamp: 1724800000,
      type: 'image',
      image: {
        id: 'media_id_123',
        mime_type: 'image/jpeg',
        caption: 'Payment proof',
      },
    };

    const result = parseLogicalEventToDomain('message', payload);

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('message');
    if (result?.kind === 'message') {
      expect(result.message.type).toBe('IMAGE');
      expect(result.message.providerMessageId).toBe('wamid.HBgL987654321');
      if (result.message.type === 'IMAGE') {
        expect(result.message.caption).toBe('Payment proof');
        expect(result.message.mimeType).toBe('image/jpeg');
        expect(result.message.mediaUrl).toBe('media_id_123');
      }
    }
  });

  it('provides fallbacks for unsupported/special message types', () => {
    const payload = {
      id: 'wamid.HBgL_location',
      from: '9230011122233',
      timestamp: '1724800000',
      type: 'location',
      location: { name: 'Office', address: 'Main Street' },
    };

    const result = parseLogicalEventToDomain('message', payload);

    expect(result).not.toBeNull();
    if (result?.kind === 'message' && result.message.type === 'TEXT') {
      expect(result.message.body).toContain('Location');
    }
  });

  it('parses valid status updates (DELIVERED)', () => {
    const payload = {
      id: 'wamid.outbound_123',
      status: 'delivered',
      timestamp: '1724800100',
      recipient_id: '923001234567',
    };

    const result = parseLogicalEventToDomain('status', payload);

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('status');
    if (result?.kind === 'status') {
      expect(result.statusUpdate.providerMessageId).toBe('wamid.outbound_123');
      expect(result.statusUpdate.status).toBe('DELIVERED');
      expect(result.statusUpdate.errorCode).toBeNull();
    }
  });

  it('parses status updates with error details (FAILED)', () => {
    const payload = {
      id: 'wamid.outbound_456',
      status: 'failed',
      timestamp: '1724800200',
      errors: [{ code: 131026, title: 'Message undeliverable' }],
    };

    const result = parseLogicalEventToDomain('status', payload);

    expect(result).not.toBeNull();
    if (result?.kind === 'status') {
      expect(result.statusUpdate.status).toBe('FAILED');
      expect(result.statusUpdate.errorCode).toBe('131026');
      expect(result.statusUpdate.errorMessage).toBe('Message undeliverable');
    }
  });

  it('returns null for malformed or unknown events', () => {
    expect(parseLogicalEventToDomain('unknown', { foo: 'bar' })).toBeNull();
    expect(parseLogicalEventToDomain('message', {})).toBeNull();
    expect(parseLogicalEventToDomain('status', { id: '123' })).toBeNull();
  });
});
