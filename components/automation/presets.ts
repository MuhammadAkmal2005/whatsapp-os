/**
 * Ready-made automations, offered to a workspace that has none yet.
 *
 * There is one table here and both screens that show a preset read from it: the picker on
 * the automations page and the builder that opens when one is chosen. They used to hold
 * separate copies, and the copies had already disagreed — the picker offered "Idle Chat
 * Follow-up" and the builder it opened was titled "Idle Conversation Reminder". A shop
 * owner clicking a name and landing on a different one has no way to tell which of the two
 * is the thing they picked.
 *
 * The picker shows no summary sentence of its own. What a preset does is derived from the
 * trigger and the actions below, so the description on the card and the rule in the builder
 * cannot drift apart: they are the same data, read twice.
 *
 * The message bodies are starting points a shop owner is expected to rewrite in their own
 * voice, so they are deliberately plain and make no promise the business has not made —
 * no discount, no delivery date, no stock claim.
 */

import type { ActionType, TriggerType } from '@/server/validation/automation';

/** One step of a preset. The `id` is a local key for the builder's list, not a database id. */
export type PresetAction = {
  id: string;
  type: ActionType;
  config: Record<string, unknown>;
};

/** What the builder opens with when a preset is chosen. */
export type PresetValues = {
  name: string;
  description: string;
  isActive: boolean;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  actions: PresetAction[];
};

export type AutomationPreset = {
  /** Appears in the URL as `?template=`, so it is stable and lower case. */
  id: string;
  /** What the card calls it. The builder uses `values.name`, which reads the same. */
  headline: string;
  values: PresetValues;
};

export const AUTOMATION_PRESETS: readonly AutomationPreset[] = [
  {
    id: 'welcome-tag',
    headline: 'Greet a new enquiry',
    values: {
      name: 'Greet a new enquiry',
      description: 'Replies to a greeting or a price question, and marks the customer as a new enquiry.',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: {
        keywords: ['hi', 'hello', 'salam', 'assalamualaikum', 'price'],
        matchMode: 'ANY',
        caseSensitive: false,
      },
      actions: [
        {
          id: 'act-1',
          type: 'SEND_MESSAGE',
          config: {
            body: 'Assalamualaikum! Thank you for getting in touch. How can we help you today?',
          },
        },
        { id: 'act-2', type: 'ADD_TAG', config: { tags: ['new-enquiry'] } },
      ],
    },
  },
  {
    id: 'order-followup',
    headline: 'Follow up a confirmed order',
    values: {
      name: 'Follow up a confirmed order',
      description: 'Waits ten minutes after you confirm an order, then messages the customer.',
      isActive: true,
      triggerType: 'ORDER_STATUS_CHANGED',
      triggerConfig: { fromStatus: 'PENDING', toStatus: 'CONFIRMED' },
      actions: [
        { id: 'act-1', type: 'WAIT', config: { durationMinutes: 10 } },
        {
          id: 'act-2',
          type: 'SEND_MESSAGE',
          config: {
            // No delivery window: the shop sets its own, and a promise this file invented
            // would be a promise the business never made.
            body: 'Your order is confirmed — shukriya! We will message you again as soon as it is on its way.',
          },
        },
        { id: 'act-3', type: 'ADD_TAG', config: { tags: ['order-confirmed'] } },
      ],
    },
  },
  {
    id: 'idle-reminder',
    headline: 'Check back on a quiet chat',
    values: {
      name: 'Check back on a quiet chat',
      description: 'Nudges a customer who went quiet for an hour, and tells your team it happened.',
      isActive: true,
      triggerType: 'CONVERSATION_IDLE',
      triggerConfig: { idleMinutes: 60 },
      actions: [
        {
          id: 'act-1',
          type: 'SEND_MESSAGE',
          config: {
            body: 'Just checking in — are you still deciding, or is there anything we can help with?',
          },
        },
        {
          id: 'act-2',
          type: 'NOTIFY_TEAM',
          config: { title: 'Follow-up sent to a quiet chat', level: 'INFO' },
        },
      ],
    },
  },
  {
    id: 'vip-escalation',
    headline: 'Escalate a qualified lead',
    values: {
      name: 'Escalate a qualified lead',
      description: 'Raises the priority and alerts your team when a lead reaches Qualified.',
      isActive: true,
      triggerType: 'LEAD_STAGE_CHANGED',
      triggerConfig: { toStage: 'QUALIFIED' },
      actions: [
        { id: 'act-1', type: 'SET_PRIORITY', config: { priority: 'HIGH' } },
        {
          id: 'act-2',
          type: 'NOTIFY_TEAM',
          config: {
            title: 'A lead is ready to close',
            body: 'This customer reached the Qualified stage. Worth a look.',
            level: 'WARNING',
          },
        },
        {
          id: 'act-3',
          type: 'CREATE_NOTE',
          config: { content: 'Priority raised automatically on reaching the Qualified stage.' },
        },
      ],
    },
  },
];

/** What the builder opens with when no preset was chosen. */
export const BLANK_AUTOMATION: PresetValues = {
  name: '',
  description: '',
  isActive: true,
  triggerType: 'MESSAGE_CONTAINS',
  triggerConfig: { keywords: ['help', 'order'], matchMode: 'ANY', caseSensitive: false },
  actions: [
    {
      id: 'act-1',
      type: 'SEND_MESSAGE',
      config: { body: 'Thank you for your message! How can we help?' },
    },
  ],
};

/** Resolves a `?template=` value, ignoring one that names no preset. */
export function findAutomationPreset(id: string | undefined): AutomationPreset | undefined {
  if (!id) return undefined;
  return AUTOMATION_PRESETS.find((preset) => preset.id === id);
}
