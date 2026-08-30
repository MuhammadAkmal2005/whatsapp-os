'use server';

/**
 * Notification Server Actions.
 *
 * Provides actions for listing, marking notifications as read, and fetching
 * unread notification counts for the authenticated user and workspace.
 */

import { revalidatePath } from 'next/cache';

import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/server/services/notification/notification.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import { uuidSchema } from '@/server/validation/automation';

export interface NotificationItemDTO {
  id: string;
  type: string;
  level: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationOverviewDTO {
  unreadCount: number;
  notifications: NotificationItemDTO[];
}

/**
 * Fetches recent notifications and unread badge count for the active workspace.
 */
export async function getNotificationOverviewAction(): Promise<NotificationOverviewDTO> {
  const context = await requireTenantContext();

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(context, { limit: 15 }),
    getUnreadNotificationCount(context),
  ]);

  return {
    unreadCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      level: n.level,
      title: n.title,
      body: n.body,
      resourceType: n.resourceType,
      resourceId: n.resourceId,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationReadAction(notificationId: string): Promise<{ success: boolean }> {
  const context = await requireTenantContext();

  const idParsed = uuidSchema.safeParse(notificationId);
  if (!idParsed.success) {
    return { success: false };
  }

  await markNotificationAsRead(context, notificationId);
  revalidatePath('/dashboard');
  return { success: true };
}

/**
 * Marks all notifications for the active workspace member as read.
 */
export async function markAllNotificationsReadAction(): Promise<{ success: boolean }> {
  const context = await requireTenantContext();

  await markAllNotificationsAsRead(context);
  revalidatePath('/dashboard');
  return { success: true };
}
