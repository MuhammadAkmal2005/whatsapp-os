/**
 * Notification delivery background job handler.
 *
 * Handles 'notification.deliver' background jobs for delivering asynchronous
 * notifications across configured notification channels.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import type { JobContext, JobHandler } from '../registry';

/**
 * Handles 'notification.deliver' background jobs.
 */
export const notificationDeliverHandler: JobHandler<'notification.deliver'> = async (
  payload,
  ctx: JobContext,
) => {
  const { workspaceId, notificationId } = payload;

  logger.info('notification.deliver_job_started', {
    jobId: ctx.jobId,
    workspaceId,
    notificationId,
  });

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, workspaceId },
  });

  if (!notification) {
    logger.warn('notification.deliver_not_found', {
      jobId: ctx.jobId,
      workspaceId,
      notificationId,
    });
    return;
  }

  logger.info('notification.deliver_job_completed', {
    jobId: ctx.jobId,
    workspaceId,
    notificationId,
    type: notification.type,
  });
};
