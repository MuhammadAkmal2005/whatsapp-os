/**
 * Notification repository.
 *
 * Tenant-scoped data access for notifications.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { NotificationLevel, NotificationType } from '@prisma/client';

export type CreateNotificationData = {
  memberId?: string | null;
  type: NotificationType;
  level?: NotificationLevel;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
};

export type NotificationFilters = {
  memberId?: string | null;
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
};

export async function createNotification(
  db: Db,
  workspaceId: string,
  data: CreateNotificationData,
) {
  return db.notification.create({
    data: {
      workspaceId,
      memberId: data.memberId ?? null,
      type: data.type,
      level: data.level ?? 'INFO',
      title: data.title,
      body: data.body ?? null,
      resourceType: data.resourceType ?? null,
      resourceId: data.resourceId ?? null,
    },
  });
}

export async function listNotifications(
  db: Db,
  workspaceId: string,
  filters: NotificationFilters = {},
) {
  const limit = filters.limit ?? 50;

  return db.notification.findMany({
    where: {
      workspaceId,
      ...(filters.memberId !== undefined
        ? { OR: [{ memberId: filters.memberId }, { memberId: null }] }
        : {}),
      ...(filters.unreadOnly ? { readAt: null } : {}),
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

export async function markNotificationAsRead(
  db: Db,
  workspaceId: string,
  notificationId: string,
  memberId?: string,
) {
  return db.notification.updateMany({
    where: {
      id: notificationId,
      workspaceId,
      ...(memberId ? { OR: [{ memberId }, { memberId: null }] } : {}),
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsAsRead(
  db: Db,
  workspaceId: string,
  memberId?: string,
) {
  return db.notification.updateMany({
    where: {
      workspaceId,
      ...(memberId ? { OR: [{ memberId }, { memberId: null }] } : {}),
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function countUnreadNotifications(
  db: Db,
  workspaceId: string,
  memberId?: string,
): Promise<number> {
  return db.notification.count({
    where: {
      workspaceId,
      ...(memberId ? { OR: [{ memberId }, { memberId: null }] } : {}),
      readAt: null,
    },
  });
}
