/**
 * Automation Validation Schemas.
 *
 * Defines Zod schemas for automation triggers, actions, configurations,
 * and CRUD operations across the WhatsApp OS platform.
 */

import { z } from 'zod';
import {
  CONVERSATION_STATUSES,
  HANDOFF_REASONS,
  PRIORITIES,
} from './conversation';

export const uuidSchema = z.string().uuid('Must be a valid UUID.');

export const TRIGGER_TYPES = [
  'MESSAGE_RECEIVED',
  'MESSAGE_CONTAINS',
  'CONVERSATION_OPENED',
  'CONVERSATION_IDLE',
  'CONVERSATION_RESOLVED',
  'CONTACT_CREATED',
  'LEAD_STAGE_CHANGED',
  'ORDER_CREATED',
  'ORDER_STATUS_CHANGED',
  'PAYMENT_RECEIVED',
  'APPOINTMENT_UPCOMING',
  'HANDOFF_REQUESTED',
  'LOW_STOCK',
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export const triggerTypeSchema = z.enum(TRIGGER_TYPES);

export const ACTION_TYPES = [
  'SEND_MESSAGE',
  'SEND_TEMPLATE',
  'WAIT',
  'ADD_TAG',
  'REMOVE_TAG',
  'ASSIGN_CONVERSATION',
  'SET_CONVERSATION_STATUS',
  'SET_PRIORITY',
  'SET_LEAD_STAGE',
  'PAUSE_AI',
  'RESUME_AI',
  'NOTIFY_TEAM',
  'CREATE_NOTE',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export const actionTypeSchema = z.enum(ACTION_TYPES);

export const RUN_STATUSES = [
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export const runStatusSchema = z.enum(RUN_STATUSES);

// ── Trigger Config Schemas ───────────────────────────────────────────────────

export const messageContainsConfigSchema = z.object({
  keywords: z.array(z.string().min(1).max(100)).min(1).max(50),
  matchMode: z.enum(['ANY', 'ALL', 'EXACT']).default('ANY'),
  caseSensitive: z.boolean().default(false),
});

export const conversationIdleConfigSchema = z.object({
  idleMinutes: z.number().int().min(1).max(10080), // Up to 7 days
});

export const leadStageChangedConfigSchema = z.object({
  fromStage: z.string().max(50).optional().nullable(),
  toStage: z.string().max(50).optional().nullable(),
});

export const orderStatusChangedConfigSchema = z.object({
  fromStatus: z.string().max(50).optional().nullable(),
  toStatus: z.string().max(50).optional().nullable(),
});

export const lowStockConfigSchema = z.object({
  threshold: z.number().int().min(0).default(5),
});

export const triggerConfigSchema = z
  .union([
    messageContainsConfigSchema,
    conversationIdleConfigSchema,
    leadStageChangedConfigSchema,
    orderStatusChangedConfigSchema,
    lowStockConfigSchema,
    z.record(z.string(), z.unknown()),
  ])
  .optional()
  .nullable();

// ── Action Config Schemas ────────────────────────────────────────────────────

export const sendMessageActionConfigSchema = z.object({
  body: z.string().min(1).max(4096),
});

export const sendTemplateActionConfigSchema = z.object({
  templateName: z.string().min(1).max(128),
  language: z.string().min(2).max(10).default('en'),
  parameters: z.record(z.string(), z.string()).optional(),
});

export const waitActionConfigSchema = z
  .object({
    durationMinutes: z.number().int().min(0).max(43200).optional(), // Up to 30 days
    durationSeconds: z.number().int().min(1).max(2592000).optional(),
  })
  .refine(
    (data) =>
      (data.durationMinutes !== undefined && data.durationMinutes > 0) ||
      (data.durationSeconds !== undefined && data.durationSeconds > 0),
    {
      message:
        'Must specify either durationMinutes or durationSeconds greater than 0',
    },
  );

export const addTagActionConfigSchema = z.object({
  tags: z.array(z.string().min(1).max(50)).min(1).max(20),
});

export const removeTagActionConfigSchema = z.object({
  tags: z.array(z.string().min(1).max(50)).min(1).max(20),
});

export const assignConversationActionConfigSchema = z.object({
  memberId: uuidSchema.nullable(),
});

export const setConversationStatusActionConfigSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES),
});

export const setPriorityActionConfigSchema = z.object({
  priority: z.enum(PRIORITIES),
});

export const setLeadStageActionConfigSchema = z.object({
  stage: z.string().min(1).max(50),
});

export const pauseAiActionConfigSchema = z.object({
  reason: z.enum(HANDOFF_REASONS).optional().default('MANUAL_TAKEOVER'),
});

export const resumeAiActionConfigSchema = z.object({}).optional().default({});

export const notifyTeamActionConfigSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional().nullable(),
  level: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
  memberId: uuidSchema.optional().nullable(),
});

export const createNoteActionConfigSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const actionConfigSchema = z.record(z.string(), z.unknown());

export const actionItemSchema = z.object({
  position: z.number().int().min(0).max(50),
  type: actionTypeSchema,
  config: actionConfigSchema,
});

export type ActionItemInput = z.infer<typeof actionItemSchema>;

// ── CRUD Input Schemas ───────────────────────────────────────────────────────

export const createAutomationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional().default(false),
  triggerType: triggerTypeSchema,
  triggerConfig: triggerConfigSchema,
  actions: z
    .array(actionItemSchema)
    .min(1, 'At least one action is required')
    .max(50),
});

export type CreateAutomationInput = z.input<typeof createAutomationSchema>;

export const updateAutomationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
    triggerType: triggerTypeSchema,
    triggerConfig: triggerConfigSchema,
    actions: z.array(actionItemSchema).min(1).max(50).optional(),
  })
  .partial();

export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

export const listAutomationsSchema = z.object({
  isActive: z.boolean().optional(),
  triggerType: triggerTypeSchema.optional(),
  search: z.string().max(100).optional().nullable(),
  cursor: uuidSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type ListAutomationsInput = z.infer<typeof listAutomationsSchema>;

export const triggerEventSchema = z.object({
  triggerType: triggerTypeSchema,
  subjectType: z.string().min(1).max(64),
  subjectId: uuidSchema,
  eventKey: z.string().max(128).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type TriggerEvent = z.infer<typeof triggerEventSchema>;
