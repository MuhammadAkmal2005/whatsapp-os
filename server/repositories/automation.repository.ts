/**
 * Automation repository.
 *
 * Tenant-scoped data access for automations, automation actions,
 * and automation runs.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type {
  ActionType,
  Prisma,
  RunStatus,
  TriggerType,
} from '@prisma/client';

export type CreateActionData = {
  position: number;
  type: ActionType;
  config: Record<string, unknown>;
};

export type CreateAutomationData = {
  name: string;
  description?: string | null;
  isActive?: boolean;
  triggerType: TriggerType;
  triggerConfig?: Record<string, unknown> | null;
  actions: CreateActionData[];
  createdByMemberId?: string | null;
};

export type UpdateAutomationData = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  triggerType?: TriggerType;
  triggerConfig?: Record<string, unknown> | null;
  actions?: CreateActionData[];
};

export type AutomationFilters = {
  isActive?: boolean;
  triggerType?: TriggerType;
  search?: string | null;
  cursor?: string;
  limit?: number;
};

export async function createAutomation(
  db: Db,
  workspaceId: string,
  data: CreateAutomationData,
) {
  return db.automation.create({
    data: {
      workspaceId,
      name: data.name,
      description: data.description ?? null,
      isActive: data.isActive ?? false,
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig as Prisma.InputJsonValue ?? undefined,
      createdByMemberId: data.createdByMemberId ?? null,
      actions: {
        create: data.actions.map((act) => ({
          workspaceId,
          position: act.position,
          type: act.type,
          config: act.config as Prisma.InputJsonValue,
        })),
      },
    },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
    },
  });
}

export async function findAutomationById(
  db: Db,
  workspaceId: string,
  id: string,
) {
  return db.automation.findFirst({
    where: { id, workspaceId },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
      createdBy: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      },
    },
  });
}

export async function listAutomations(
  db: Db,
  workspaceId: string,
  filters: AutomationFilters = {},
) {
  const limit = filters.limit ?? 50;

  return db.automation.findMany({
    where: {
      workspaceId,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.triggerType ? { triggerType: filters.triggerType } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { description: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
      _count: {
        select: { runs: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(filters.cursor
      ? {
          skip: 1,
          cursor: { id: filters.cursor },
        }
      : {}),
  });
}

export async function countAutomations(
  db: Db,
  workspaceId: string,
  filters: Pick<AutomationFilters, 'isActive' | 'triggerType'> = {},
): Promise<number> {
  return db.automation.count({
    where: {
      workspaceId,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.triggerType ? { triggerType: filters.triggerType } : {}),
    },
  });
}

export async function updateAutomation(
  db: Db,
  workspaceId: string,
  id: string,
  data: UpdateAutomationData,
) {
  // If actions are replaced, we handle it in a transaction or nested writes
  const { actions, ...fields } = data;

  if (actions) {
    // Delete existing actions and re-create
    await db.automationAction.deleteMany({
      where: { automationId: id, workspaceId },
    });

    return db.automation.update({
      where: { id },
      data: {
        ...fields,
        triggerConfig: fields.triggerConfig !== undefined ? (fields.triggerConfig as Prisma.InputJsonValue) : undefined,
        actions: {
          create: actions.map((act) => ({
            workspaceId,
            position: act.position,
            type: act.type,
            config: act.config as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        actions: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  return db.automation.update({
    where: { id },
    data: {
      ...fields,
      triggerConfig: fields.triggerConfig !== undefined ? (fields.triggerConfig as Prisma.InputJsonValue) : undefined,
    },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
    },
  });
}

export async function deleteAutomation(
  db: Db,
  workspaceId: string,
  id: string,
) {
  return db.automation.deleteMany({
    where: { id, workspaceId },
  });
}

export async function findActiveAutomationsByTrigger(
  db: Db,
  workspaceId: string,
  triggerType: TriggerType,
) {
  return db.automation.findMany({
    where: {
      workspaceId,
      triggerType,
      isActive: true,
    },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

// ── Automation Runs ──────────────────────────────────────────────────────────

export type CreateAutomationRunData = {
  automationId: string;
  subjectType: string;
  subjectId: string;
  dedupeKey: string;
  status?: RunStatus;
  currentActionPosition?: number;
};

export async function createAutomationRun(
  db: Db,
  workspaceId: string,
  data: CreateAutomationRunData,
) {
  return db.automationRun.create({
    data: {
      workspaceId,
      automationId: data.automationId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      dedupeKey: data.dedupeKey,
      status: data.status ?? 'RUNNING',
      currentActionPosition: data.currentActionPosition ?? 0,
      startedAt: new Date(),
    },
  });
}

export async function findAutomationRunById(
  db: Db,
  workspaceId: string,
  runId: string,
) {
  return db.automationRun.findFirst({
    where: { id: runId, workspaceId },
    include: {
      automation: {
        include: {
          actions: {
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  });
}

export async function findAutomationRunByDedupeKey(
  db: Db,
  dedupeKey: string,
) {
  return db.automationRun.findUnique({
    where: { dedupeKey },
  });
}

export async function updateAutomationRun(
  db: Db,
  workspaceId: string,
  runId: string,
  data: {
    status?: RunStatus;
    currentActionPosition?: number;
    finishedAt?: Date | null;
    error?: string | null;
  },
) {
  return db.automationRun.updateMany({
    where: { id: runId, workspaceId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.currentActionPosition !== undefined
        ? { currentActionPosition: data.currentActionPosition }
        : {}),
      ...(data.finishedAt !== undefined ? { finishedAt: data.finishedAt } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
    },
  });
}

export async function incrementAutomationRunCount(
  db: Db,
  workspaceId: string,
  automationId: string,
) {
  return db.automation.updateMany({
    where: { id: automationId, workspaceId },
    data: {
      runCount: { increment: 1 },
      lastRunAt: new Date(),
    },
  });
}
