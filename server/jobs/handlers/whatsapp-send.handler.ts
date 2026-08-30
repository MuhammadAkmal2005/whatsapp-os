/**
 * Outbound WhatsApp Send background job handler.
 *
 * Dispatches queued outbound WhatsApp messages through the configured
 * WhatsApp provider (mock or live Meta Cloud API) and updates delivery state.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { dispatchOutboundMessage } from '@/server/services/whatsapp/outbound.service';
import type { JobContext, JobHandler } from '../registry';

/**
 * Handles 'whatsapp.send_message' background jobs.
 */
export const whatsappSendMessageHandler: JobHandler<'whatsapp.send_message'> = async (
  payload,
  ctx: JobContext,
) => {
  const { workspaceId, messageId } = payload;

  logger.info('whatsapp.send_job_started', {
    jobId: ctx.jobId,
    workspaceId,
    messageId,
  });

  await dispatchOutboundMessage({ workspaceId }, messageId);

  logger.info('whatsapp.send_job_completed', {
    jobId: ctx.jobId,
    workspaceId,
    messageId,
  });
};
