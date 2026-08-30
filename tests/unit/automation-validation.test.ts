import { describe, expect, it } from 'vitest';
import {
  createAutomationSchema,
  messageContainsConfigSchema,
  updateAutomationSchema,
  waitActionConfigSchema,
} from '@/server/validation/automation';

describe('Automation Validation Schemas', () => {
  it('validates a correct createAutomation input with SEND_MESSAGE and WAIT actions', () => {
    const input = {
      name: 'Welcome & Followup Automation',
      description: 'Sends welcome message, waits, then checks in',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS' as const,
      triggerConfig: {
        keywords: ['hello', 'hi', 'price'],
        matchMode: 'ANY' as const,
        caseSensitive: false,
      },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE' as const,
          config: { body: 'Hello! How can we help you today?' },
        },
        {
          position: 1,
          type: 'WAIT' as const,
          config: { durationMinutes: 30 },
        },
        {
          position: 2,
          type: 'SEND_MESSAGE' as const,
          config: { body: 'Still have questions? Feel free to ask!' },
        },
      ],
    };

    const parsed = createAutomationSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('rejects createAutomation with empty actions array', () => {
    const input = {
      name: 'Invalid Empty Actions',
      triggerType: 'CONVERSATION_OPENED' as const,
      actions: [],
    };

    const parsed = createAutomationSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('At least one action');
    }
  });

  it('rejects waitActionConfigSchema with 0 duration', () => {
    const parsed = waitActionConfigSchema.safeParse({ durationMinutes: 0 });
    expect(parsed.success).toBe(false);
  });

  it('validates waitActionConfigSchema with durationSeconds', () => {
    const parsed = waitActionConfigSchema.safeParse({ durationSeconds: 120 });
    expect(parsed.success).toBe(true);
  });

  it('validates messageContainsConfigSchema correctly', () => {
    const valid = messageContainsConfigSchema.safeParse({
      keywords: ['order', 'track'],
      matchMode: 'ALL',
      caseSensitive: true,
    });
    expect(valid.success).toBe(true);

    const empty = messageContainsConfigSchema.safeParse({
      keywords: [],
    });
    expect(empty.success).toBe(false);
  });

  it('validates partial updateAutomation input', () => {
    const input = {
      name: 'Updated Name',
      isActive: false,
    };

    const parsed = updateAutomationSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });
});
