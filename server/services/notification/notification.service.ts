/**
 * Notification service.
 *
 * Provides business logic for querying and updating user/workspace notifications.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import {
  countUnreadNotifications,
  createNotification as createNotificationRow,
  listNotifications as listNotificationsRows,
  markAllNotificationsAsRead as markAllNotificationsAsReadRow,
  markNotificationAsRead as markNotificationAsReadRow,
  type CreateNotificationData,
  type NotificationFilters,
} from '@/server/repositories/notification.repository';
import type { TenantContext } from '@/server/tenancy/context';

export async function listNotifications(
  ctx: TenantContext,
  filters: Omit<NotificationFilters, 'memberId'> & { forMemberOnly?: boolean } = {},
  db: Db = prisma,
) {
  const memberId = filters.forMemberOnly ? ctx.membershipId : ctx.membershipId;

  return listNotificationsRows(db, ctx.workspaceId, {
    ...filters,
    memberId,
  });
}

export async function markNotificationAsRead(
  ctx: TenantContext,
  notificationId: string,
  db: Db = prisma,
) {
  return markNotificationAsReadRow(db, ctx.workspaceId, notificationId, ctx.membershipId);
}

export async function markAllNotificationsAsRead(
  ctx: TenantContext,
  db: Db = prisma,
) {
  return markAllNotificationsAsReadRow(db, ctx.workspaceId, ctx.membershipId);
}

export async function getUnreadNotificationCount(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<number> {
  return countUnreadNotifications(db, ctx.workspaceId, ctx.membershipId);
}

export async function createSystemNotification(
  db: Db,
  workspaceId: string,
  data: CreateNotificationData,
) {
  return createNotificationRow(db, workspaceId, data);
}
