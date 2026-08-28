/**
 * Job handler for `whatsapp.process_webhook`.
 */

import 'server-only';

import { ValidationError } from '@/server/errors';
import { processWebhookEvent } from '@/server/services/whatsapp/webhook-processor.service';

import type { JobPayload } from '../job-types';
import type { JobContext, JobHandler } from '../registry';

export const whatsappWebhookHandler: JobHandler<'whatsapp.process_webhook'> = async (
  payload: JobPayload<'whatsapp.process_webhook'>,
  context: JobContext,
): Promise<void> => {
  if (!payload || typeof payload.webhookEventId !== 'string' || !payload.webhookEventId.trim()) {
    throw new ValidationError('Missing or invalid webhookEventId in job payload');
  }
  await processWebhookEvent(payload.webhookEventId, context);
};
