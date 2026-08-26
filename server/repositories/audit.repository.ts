/**
 * Audit and product-event repositories.
 *
 * Both are append-only. Audit answers "who changed what" for security and
 * compliance; product events answer "did onboarding work" for activation
 * analytics. They are kept in separate tables on purpose — mixing a security
 * ledger with a funnel makes both harder to reason about — but they share this
 * module because both are write-mostly sinks with the same shape of caller.
 *
 * `workspaceId` is nullable on both: a login or a signup happens before any
 * workspace exists.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type ActorType = 'USER' | 'AI_AGENT' | 'SYSTEM' | 'AUTOMATION' | 'CUSTOMER';

export type AuditEntry = {
  action: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  actorType?: ActorType;
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function appendAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      workspaceId: entry.workspaceId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorMemberId: entry.actorMemberId ?? null,
      actorType: entry.actorType ?? 'USER',
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: (entry.metadata ?? undefined) as never,
    },
  });
}

export type ProductEventEntry = {
  name: string;
  workspaceId?: string | null;
  userId?: string | null;
  properties?: Record<string, unknown> | null;
};

export async function appendProductEvent(db: Db, entry: ProductEventEntry): Promise<void> {
  await db.productEvent.create({
    data: {
      name: entry.name,
      workspaceId: entry.workspaceId ?? null,
      userId: entry.userId ?? null,
      properties: (entry.properties ?? undefined) as never,
    },
  });
}
