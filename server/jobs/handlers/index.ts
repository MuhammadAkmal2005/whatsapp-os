/**
 * Handler registration.
 *
 * The worker calls `registerAllHandlers` once at boot. Every job type in the
 * catalogue whose handler has been built is wired up here, and the ones belonging
 * to later phases are listed in `PENDING_HANDLERS` rather than left to be
 * discovered by absence.
 *
 * That list is not a "coming soon" label on a user-facing feature — it is a
 * developer-facing record of which seams are still open, and the worker logs it at
 * boot so the gap is visible rather than mysterious. Enqueueing one of those types
 * today produces a loud, retried failure, which is the correct behaviour: no
 * caller exists yet, so it can only happen by mistake.
 */

import 'server-only';

import { logger } from '@/lib/logger';

import { JOB_TYPES, type JobType } from '../job-types';
import { registerHandler, registeredTypes } from '../registry';
import { aiRespondHandler } from './ai-turn.handler';
import { analyticsRollupDailyHandler } from './analytics.handler';
import { automationCheckIdleHandler, automationResumeHandler, automationRunHandler } from './automation.handler';
import { maintenanceSweep } from './maintenance.handler';
import { notificationDeliverHandler } from './notification.handler';
import { whatsappSendMessageHandler } from './whatsapp-send.handler';
import { whatsappWebhookHandler } from './whatsapp-webhook.handler';

export function registerAllHandlers(): void {
  registerHandler('maintenance.sweep', maintenanceSweep);
  registerHandler('whatsapp.process_webhook', whatsappWebhookHandler);
  registerHandler('whatsapp.send_message', whatsappSendMessageHandler);
  registerHandler('ai.respond', aiRespondHandler);
  registerHandler('automation.run', automationRunHandler);
  registerHandler('automation.resume', automationResumeHandler);
  registerHandler('automation.check_idle', automationCheckIdleHandler);
  registerHandler('notification.deliver', notificationDeliverHandler);
  registerHandler('analytics.rollup_daily', analyticsRollupDailyHandler);

  const registered = new Set<JobType>(registeredTypes());
  const pending = JOB_TYPES.filter((type) => !registered.has(type));

  logger.info('worker.handlers_registered', {
    registered: [...registered].sort(),
    awaitingImplementation: pending.sort(),
  });
}
