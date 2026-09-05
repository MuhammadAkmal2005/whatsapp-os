import 'server-only';

import type { Db } from '@/db/prisma';
import { Prisma } from '@prisma/client';
import type {
  ApprovalActionType,
  ApprovalStatus,
  ApprovalRequesterType,
} from '@/server/validation/approval';

export type ActionApprovalRow = {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  contactId: string | null;
  actionType: ApprovalActionType;
  status: ApprovalStatus;
  requestedByType: ApprovalRequesterType;
  requestedById: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  payload: Prisma.JsonValue | null;
  reason: string | null;
  decisionReason: string | null;
  resolvedByMemberId: string | null;
  resolvedAt: Date | null;
  executedAt: Date | null;
  executionResult: Prisma.JsonValue | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  contact?: {
    id: string;
    name: string | null;
    phoneE164: string;
  } | null;
  resolvedByMember?: {
    id: string;
    role: string;
    user: {
      name: string;
      email: string;
    };
  } | null;
};

export const ACTION_APPROVAL_SELECT = {
  id: true,
  workspaceId: true,
  conversationId: true,
  contactId: true,
  actionType: true,
  status: true,
  requestedByType: true,
  requestedById: true,
  targetEntityType: true,
  targetEntityId: true,
  payload: true,
  reason: true,
  decisionReason: true,
  resolvedByMemberId: true,
  resolvedAt: true,
  executedAt: true,
  executionResult: true,
  idempotencyKey: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: {
      id: true,
      name: true,
      phoneE164: true,
    },
  },
  resolvedByMember: {
    select: {
      id: true,
      role: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  },
} as const;

export type CreateActionApprovalData = {
  conversationId?: string | null;
  contactId?: string | null;
  actionType: ApprovalActionType;
  status?: ApprovalStatus;
  requestedByType?: ApprovalRequesterType;
  requestedById?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  payload?: Prisma.InputJsonValue;
  reason?: string | null;
  idempotencyKey?: string | null;
};

export async function createApproval(
  db: Db,
  workspaceId: string,
  data: CreateActionApprovalData,
): Promise<ActionApprovalRow> {
  return db.actionApproval.create({
    data: {
      workspaceId,
      conversationId: data.conversationId ?? null,
      contactId: data.contactId ?? null,
      actionType: data.actionType,
      status: data.status ?? 'PENDING',
      requestedByType: data.requestedByType ?? 'AI_AGENT',
      requestedById: data.requestedById ?? null,
      targetEntityType: data.targetEntityType ?? null,
      targetEntityId: data.targetEntityId ?? null,
      payload: data.payload ?? Prisma.DbNull,
      reason: data.reason ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
    },
    select: ACTION_APPROVAL_SELECT,
  }) as unknown as Promise<ActionApprovalRow>;
}

export async function findApprovalById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<ActionApprovalRow | null> {
  return db.actionApproval.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: ACTION_APPROVAL_SELECT,
  }) as unknown as Promise<ActionApprovalRow | null>;
}

export async function findApprovalByIdempotencyKey(
  db: Db,
  workspaceId: string,
  idempotencyKey: string,
): Promise<ActionApprovalRow | null> {
  return db.actionApproval.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId,
        idempotencyKey,
      },
    },
    select: ACTION_APPROVAL_SELECT,
  }) as unknown as Promise<ActionApprovalRow | null>;
}

export type ListApprovalsOptions = {
  status?: ApprovalStatus;
  limit?: number;
  offset?: number;
};

export async function listApprovals(
  db: Db,
  workspaceId: string,
  options: ListApprovalsOptions = {},
): Promise<ActionApprovalRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  return db.actionApproval.findMany({
    where: {
      workspaceId,
      status: options.status,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: ACTION_APPROVAL_SELECT,
  }) as unknown as Promise<ActionApprovalRow[]>;
}

export async function countPendingApprovals(
  db: Db,
  workspaceId: string,
): Promise<number> {
  return db.actionApproval.count({
    where: {
      workspaceId,
      status: 'PENDING',
    },
  });
}

export type UpdateApprovalStatusData = {
  status: ApprovalStatus;
  decisionReason?: string | null;
  resolvedByMemberId?: string | null;
  resolvedAt?: Date | null;
  executedAt?: Date | null;
  executionResult?: Prisma.InputJsonValue;
};

export async function updateApprovalStatus(
  db: Db,
  workspaceId: string,
  id: string,
  data: UpdateApprovalStatusData,
): Promise<ActionApprovalRow> {
  return db.actionApproval.update({
    where: {
      id,
      workspaceId,
    },
    data: {
      status: data.status,
      decisionReason: data.decisionReason !== undefined ? data.decisionReason : undefined,
      resolvedByMemberId: data.resolvedByMemberId !== undefined ? data.resolvedByMemberId : undefined,
      resolvedAt: data.resolvedAt !== undefined ? data.resolvedAt : undefined,
      executedAt: data.executedAt !== undefined ? data.executedAt : undefined,
      executionResult: data.executionResult !== undefined ? data.executionResult : undefined,
    },
    select: ACTION_APPROVAL_SELECT,
  }) as unknown as Promise<ActionApprovalRow>;
}
