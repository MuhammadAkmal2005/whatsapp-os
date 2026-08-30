/**
 * Automation service.
 *
 * Core business logic for managing automations, including CRUD operations,
 * authorization checks, and audit logging.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  countAutomations,
  createAutomation as createAutomationRow,
  deleteAutomation as deleteAutomationRow,
  findAutomationById,
  listAutomations as listAutomationsRows,
  updateAutomation as updateAutomationRow,
  type CreateActionData,
} from '@/server/repositories/automation.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  CreateAutomationInput,
  ListAutomationsInput,
  UpdateAutomationInput,
} from '@/server/validation/automation';

export async function getAutomation(
  ctx: TenantContext,
  id: string,
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:read');

  const automation = await findAutomationById(db, ctx.workspaceId, id);
  if (!automation) {
    throw new NotFoundError('Automation');
  }

  return automation;
}

export async function listAutomations(
  ctx: TenantContext,
  input: Partial<ListAutomationsInput> = {},
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:read');

  const filters = {
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.triggerType ? { triggerType: input.triggerType } : {}),
    ...(input.search ? { search: input.search } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  };

  const [items, total] = await Promise.all([
    listAutomationsRows(db, ctx.workspaceId, filters),
    countAutomations(db, ctx.workspaceId, {
      isActive: input.isActive,
      triggerType: input.triggerType,
    }),
  ]);

  return {
    items,
    total,
    nextCursor:
      items.length === (input.limit ?? 50) && items.length > 0
        ? items[items.length - 1]!.id
        : null,
  };
}

export async function createAutomation(
  ctx: TenantContext,
  input: CreateAutomationInput,
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:create');

  const actions: CreateActionData[] = input.actions.map((act, index) => ({
    position: act.position ?? index,
    type: act.type,
    config: act.config,
  }));

  const created = await createAutomationRow(db, ctx.workspaceId, {
    name: input.name,
    description: input.description,
    isActive: input.isActive ?? false,
    triggerType: input.triggerType,
    triggerConfig: input.triggerConfig as Record<string, unknown> | null,
    actions,
    createdByMemberId: ctx.membershipId,
  });

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'automation.created',
    resourceType: 'Automation',
    resourceId: created.id,
    metadata: {
      name: created.name,
      triggerType: created.triggerType,
      actionCount: actions.length,
    },
  });

  return created;
}

export async function updateAutomation(
  ctx: TenantContext,
  id: string,
  input: UpdateAutomationInput,
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:update');

  const existing = await findAutomationById(db, ctx.workspaceId, id);
  if (!existing) {
    throw new NotFoundError('Automation');
  }

  const actions: CreateActionData[] | undefined = input.actions?.map(
    (act, index) => ({
      position: act.position ?? index,
      type: act.type,
      config: act.config,
    }),
  );

  const updated = await updateAutomationRow(db, ctx.workspaceId, id, {
    name: input.name,
    description: input.description,
    isActive: input.isActive,
    triggerType: input.triggerType,
    triggerConfig: input.triggerConfig as Record<string, unknown> | null,
    actions,
  });

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'automation.updated',
    resourceType: 'Automation',
    resourceId: id,
    metadata: {
      name: updated.name,
      isActive: updated.isActive,
      triggerType: updated.triggerType,
    },
  });

  return updated;
}

export async function toggleAutomation(
  ctx: TenantContext,
  id: string,
  isActive: boolean,
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:update');

  const existing = await findAutomationById(db, ctx.workspaceId, id);
  if (!existing) {
    throw new NotFoundError('Automation');
  }

  const updated = await updateAutomationRow(db, ctx.workspaceId, id, {
    isActive,
  });

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'automation.toggled',
    resourceType: 'Automation',
    resourceId: id,
    metadata: {
      isActive,
    },
  });

  return updated;
}

export async function deleteAutomation(
  ctx: TenantContext,
  id: string,
  db: Db = prisma,
) {
  requirePermission(ctx, 'automation:delete');

  const existing = await findAutomationById(db, ctx.workspaceId, id);
  if (!existing) {
    throw new NotFoundError('Automation');
  }

  await deleteAutomationRow(db, ctx.workspaceId, id);

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'automation.deleted',
    resourceType: 'Automation',
    resourceId: id,
    metadata: {
      name: existing.name,
    },
  });
}
