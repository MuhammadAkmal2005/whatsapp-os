import { describe, expect, it } from 'vitest';

import { extractLogicalEvents } from '@/server/services/whatsapp/webhook.parser';

describe('extractLogicalEvents', () => {
  it('extracts a single inbound message event with phone_number_id', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550001111',
                  phone_number_id: '106540352242922',
                },
                contacts: [{ profile: { name: 'Kerry Fisher' }, wa_id: '923001234567' }],
                messages: [
                  {
                    from: '923001234567',
                    id: 'wamid.HBgMOTIzMDAxMjM0NTY3FQIAEhgUM0E0QkNERUY=',
                    timestamp: '1756200000',
                    type: 'text',
                    text: { body: 'black kurta XL available hai?' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = extractLogicalEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: '106540352242922',
      providerEventId: 'wamid.HBgMOTIzMDAxMjM0NTY3FQIAEhgUM0E0QkNERUY=',
      payload: {
        from: '923001234567',
        id: 'wamid.HBgMOTIzMDAxMjM0NTY3FQIAEhgUM0E0QkNERUY=',
        timestamp: '1756200000',
        type: 'text',
        text: { body: 'black kurta XL available hai?' },
        metadata: {
          display_phone_number: '15550001111',
          phone_number_id: '106540352242922',
        },
        contacts: [{ profile: { name: 'Kerry Fisher' }, wa_id: '923001234567' }],
      },
    });
  });

  it('extracts multiple message events from a single payload', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106540352242922' },
                messages: [
                  { from: '923001234567', id: 'wamid.msg1', type: 'text', text: { body: 'msg 1' } },
                  { from: '923001234567', id: 'wamid.msg2', type: 'text', text: { body: 'msg 2' } },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = extractLogicalEvents(payload);
    expect(events).toHaveLength(2);
    expect(events[0]!.providerEventId).toBe('wamid.msg1');
    expect(events[0]!.type).toBe('message');
    expect(events[1]!.providerEventId).toBe('wamid.msg2');
    expect(events[1]!.type).toBe('message');
  });

  it('extracts status updates and constructs distinct status IDs to prevent collision', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106540352242922' },
                statuses: [
                  { id: 'wamid.common123', status: 'delivered', timestamp: '1756200001' },
                  { id: 'wamid.common123', status: 'read', timestamp: '1756200005' },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = extractLogicalEvents(payload);
    expect(events).toHaveLength(2);

    expect(events[0]).toMatchObject({
      type: 'status',
      phoneNumberId: '106540352242922',
      providerEventId: 'wamid.common123:delivered',
    });

    expect(events[1]).toMatchObject({
      type: 'status',
      phoneNumberId: '106540352242922',
      providerEventId: 'wamid.common123:read',
    });

    // Verify delivered and read IDs never collide despite having the same wamid
    expect(events[0]!.providerEventId).not.toBe(events[1]!.providerEventId);
  });

  it('handles mixed messages and statuses in the same payload', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '106540352242922' },
                messages: [{ from: '923001', id: 'wamid.inbound', type: 'text' }],
                statuses: [{ id: 'wamid.outbound', status: 'sent' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = extractLogicalEvents(payload);
    expect(events).toHaveLength(2);
    expect(events[0]!.providerEventId).toBe('wamid.inbound');
    expect(events[0]!.type).toBe('message');
    expect(events[1]!.providerEventId).toBe('wamid.outbound:sent');
    expect(events[1]!.type).toBe('status');
  });

  it('handles unknown or malformed payload structures safely as unknown events', () => {
    // Non-object payload
    expect(extractLogicalEvents(null)[0]!.type).toBe('unknown');
    expect(extractLogicalEvents(123)[0]!.type).toBe('unknown');
    expect(extractLogicalEvents('string')[0]!.type).toBe('unknown');

    // Empty entry array
    expect(extractLogicalEvents({ entry: [] })[0]!.type).toBe('unknown');

    // Non-array changes
    expect(extractLogicalEvents({ entry: [{ id: '123', changes: null }] })[0]!.type).toBe('unknown');

    // Empty value / unsupported change field
    const unsupportedChange = {
      entry: [
        {
          id: '123',
          changes: [{ field: 'account_alerts', value: { alert: 'warning' } }],
        },
      ],
    };
    const events = extractLogicalEvents(unsupportedChange);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('unknown');
    expect(events[0]!.providerEventId).toMatch(/^unknown:/);
  });

  it('handles message missing id gracefully as unknown', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'phone123' },
                messages: [{ from: '92300', text: { body: 'no id' } }],
              },
            },
          ],
        },
      ],
    };

    const events = extractLogicalEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('unknown');
    expect(events[0]!.phoneNumberId).toBe('phone123');
    expect(events[0]!.providerEventId).toMatch(/^unknown:/);
  });
});
