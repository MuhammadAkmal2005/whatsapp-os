import { z } from 'zod';

export const approvalActionTypeSchema = z.enum([
  'ORDER_CANCEL',
  'ORDER_MODIFY',
  'REFUND_REQUEST',
  'ADDRESS_CHANGE',
  'EXCEPTIONAL_DISCOUNT',
]);
export type ApprovalActionType = z.infer<typeof approvalActionTypeSchema>;

export const approvalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRequesterTypeSchema = z.enum([
  'AI_AGENT',
  'CUSTOMER',
  'SYSTEM',
]);
export type ApprovalRequesterType = z.infer<typeof approvalRequesterTypeSchema>;

export const createApprovalRequestSchema = z.object({
  actionType: approvalActionTypeSchema,
  conversationId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  requestedByType: approvalRequesterTypeSchema.default('AI_AGENT'),
  requestedById: z.string().uuid().optional().nullable(),
  targetEntityType: z.string().min(1).max(50).optional().nullable(),
  targetEntityId: z.string().min(1).max(100).optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable(),
  reason: z.string().min(1).max(500).optional().nullable(),
  idempotencyKey: z.string().min(1).max(200).optional().nullable(),
});
export type CreateApprovalRequestInput = z.input<typeof createApprovalRequestSchema>;

export const approveApprovalSchema = z.object({
  decisionReason: z.string().max(500).optional().nullable(),
});
export type ApproveApprovalInput = z.infer<typeof approveApprovalSchema>;

export const rejectApprovalSchema = z.object({
  decisionReason: z.string().min(1, 'A rejection reason is required').max(500),
});
export type RejectApprovalInput = z.infer<typeof rejectApprovalSchema>;

export const listApprovalsQuerySchema = z.object({
  status: approvalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
