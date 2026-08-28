/**
 * Validation schemas for conversations and messages.
 *
 * Backs both the server actions and the service layer to guarantee that inputs
 * are well-formed before touching database queries.
 */

import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';

export const CHANNELS = [
  'WHATSAPP',
  'INSTAGRAM',
  'MESSENGER',
  'WEBCHAT',
  'SMS',
  'EMAIL',
] as const;

export const CONVERSATION_STATUSES = [
  'OPEN',
  'PENDING',
  'RESOLVED',
  'CLOSED',
] as const;

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export const HANDOFF_REASONS = [
  'CUSTOMER_REQUESTED',
  'LOW_CONFIDENCE',
  'UNKNOWN_QUESTION',
  'REFUND_REQUEST',
  'COMPLAINT',
  'NEGATIVE_SENTIMENT',
  'HIGH_VALUE_CUSTOMER',
  'SENSITIVE_TOPIC',
  'PAYMENT_ISSUE',
  'AI_ERROR',
  'OUTSIDE_BUSINESS_HOURS',
  'MANUAL_TAKEOVER',
] as const;

export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

export const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'DOCUMENT',
  'STICKER',
  'LOCATION',
  'CONTACTS',
  'INTERACTIVE',
  'TEMPLATE',
  'REACTION',
  'SYSTEM',
  'UNSUPPORTED',
] as const;

export const MESSAGE_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'RECEIVED',
] as const;

export type Channel = (typeof CHANNELS)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type HandoffReason = (typeof HANDOFF_REASONS)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type MessageType = (typeof MESSAGE_TYPES)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

const BODY_MAX = 4096;
const SEARCH_MAX = 100;
const CAPTION_MAX = 1024;
const FILENAME_MAX = 255;
const MIME_TYPE_MAX = 128;

export const conversationId = z.string().uuid('Invalid conversation reference.');
export const messageId = z.string().uuid('Invalid message reference.');
export const contactId = z.string().uuid('Invalid contact reference.');
export const memberId = z.string().uuid('Invalid member reference.');
export const phoneNumberId = z.string().uuid('Invalid phone number reference.');

const optionalUuid = (msg: string) =>
  z
    .string()
    .uuid(msg)
    .nullable()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null));

// ── Conversation Schemas ───────────────────────────────────────────────────

export const createConversationSchema = z.object({
  contactId: z.string().uuid('Choose a customer for this conversation.'),
  channel: z.enum(CHANNELS).optional().default('WHATSAPP'),
  phoneNumberId: optionalUuid('Invalid phone number reference.'),
  status: z.enum(CONVERSATION_STATUSES).optional().default('OPEN'),
  priority: z.enum(PRIORITIES).optional().default('NORMAL'),
  assignedToMemberId: optionalUuid('Invalid assignee reference.'),
  initialMessage: z
    .object({
      body: z.string().trim().min(1, 'Enter a message body.').max(BODY_MAX, 'Message is too long.'),
      type: z.enum(MESSAGE_TYPES).optional().default('TEXT'),
    })
    .optional(),
});

export const listConversationsSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedToMemberId: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  contactId: z.string().uuid().optional(),
  search: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  channel: z.enum(CHANNELS).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
});

export const updateConversationStatusSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  status: z.enum(CONVERSATION_STATUSES, {
    errorMap: () => ({ message: 'Choose a valid conversation status.' }),
  }),
});

export const assignConversationSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  assignedToMemberId: z
    .string()
    .uuid('Invalid team member reference.')
    .nullable()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
});

export const updateConversationPrioritySchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  priority: z.enum(PRIORITIES, {
    errorMap: () => ({ message: 'Choose a valid priority.' }),
  }),
});

export const toggleConversationAiSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  aiEnabled: z.boolean(),
  handoffReason: z.enum(HANDOFF_REASONS).nullable().optional(),
});

export const deleteConversationSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
});

// ── Message Schemas ────────────────────────────────────────────────────────

export const messageAttachmentInputSchema = z.object({
  kind: z.enum(MESSAGE_TYPES),
  storageKey: z.string().nullable().optional(),
  providerMediaId: z.string().nullable().optional(),
  mimeType: z.string().trim().min(1).max(MIME_TYPE_MAX),
  fileName: z.string().trim().max(FILENAME_MAX).nullable().optional(),
  byteSize: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  caption: z.string().trim().max(CAPTION_MAX).nullable().optional(),
  transcript: z.string().nullable().optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  direction: z.enum(MESSAGE_DIRECTIONS).optional().default('OUTBOUND'),
  type: z.enum(MESSAGE_TYPES).optional().default('TEXT'),
  body: z
    .string()
    .trim()
    .max(BODY_MAX, 'Message is too long.')
    .nullable()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: z.enum(MESSAGE_STATUSES).optional(),
  senderMemberId: optionalUuid('Invalid sender member reference.'),
  senderContactId: optionalUuid('Invalid sender contact reference.'),
  sentByAi: z.boolean().optional().default(false),
  aiAgentId: optionalUuid('Invalid AI agent reference.'),
  templateName: z.string().trim().max(100).nullable().optional(),
  templateLanguage: z.string().trim().max(10).nullable().optional(),
  payload: z.record(z.unknown()).nullable().optional(),
  providerMessageId: z.string().trim().nullable().optional(),
  replyToProviderMessageId: z.string().trim().nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  attachments: z.array(messageAttachmentInputSchema).optional().default([]),
}).refine(
  (data) => (data.body !== null && data.body !== undefined && data.body.length > 0) || (data.attachments && data.attachments.length > 0) || data.type === 'TEMPLATE' || data.type === 'INTERACTIVE',
  { message: 'Message must have text or at least one attachment.', path: ['body'] },
);

export const listMessagesSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation reference.'),
  direction: z.enum(MESSAGE_DIRECTIONS).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const updateMessageStatusSchema = z.object({
  messageId: z.string().uuid('Invalid message reference.'),
  status: z.enum(MESSAGE_STATUSES, {
    errorMap: () => ({ message: 'Choose a valid message status.' }),
  }),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  occurredAt: z.coerce.date().optional(),
});

// ── Inferred Types ─────────────────────────────────────────────────────────

export type CreateConversationInput = {
  contactId: string;
  channel?: Channel;
  phoneNumberId?: string | null;
  status?: ConversationStatus;
  priority?: Priority;
  assignedToMemberId?: string | null;
  initialMessage?: {
    body: string;
    type?: MessageType;
  };
};

export type ListConversationsInput = {
  status?: ConversationStatus;
  priority?: Priority;
  assignedToMemberId?: string;
  contactId?: string;
  search?: string | null;
  channel?: Channel;
  cursor?: string;
  limit?: number;
};

export type UpdateConversationStatusInput = z.infer<typeof updateConversationStatusSchema>;
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
export type UpdateConversationPriorityInput = z.infer<typeof updateConversationPrioritySchema>;
export type ToggleConversationAiInput = z.infer<typeof toggleConversationAiSchema>;
export type DeleteConversationInput = z.infer<typeof deleteConversationSchema>;

export type MessageAttachmentInput = z.infer<typeof messageAttachmentInputSchema>;

export type SendMessageInput = {
  conversationId: string;
  direction?: MessageDirection;
  type?: MessageType;
  body?: string | null;
  status?: MessageStatus;
  senderMemberId?: string | null;
  senderContactId?: string | null;
  sentByAi?: boolean;
  aiAgentId?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  payload?: Record<string, unknown> | null;
  providerMessageId?: string | null;
  replyToProviderMessageId?: string | null;
  occurredAt?: Date;
  attachments?: MessageAttachmentInput[];
};

export type ListMessagesInput = {
  conversationId: string;
  direction?: MessageDirection;
  cursor?: string;
  limit?: number;
};

export type UpdateMessageStatusInput = z.infer<typeof updateMessageStatusSchema>;
