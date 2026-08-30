/**
 * Webhook Processor Service.
 *
 * Processes background `whatsapp.process_webhook` jobs:
 * 1. Loads `WebhookEvent` record and manages lifecycle state machine.
 * 2. Resolves tenant workspace mapping from `phoneNumberId`.
 * 3. Parses normalized logical event payloads into domain DTOs.
 * 4. Calls `processInboundMessage` or `processStatusUpdate`.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { NotFoundError, ValidationError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { findPhoneNumberWithAccountByPhoneNumberId } from '@/server/repositories/whatsapp-account.repository';
import {
  findWebhookEventById,
  updateWebhookEventStatus,
} from '@/server/repositories/webhook-event.repository';
import { processInboundMessage, processStatusUpdate } from './inbound.service';
import { queue } from '@/server/jobs';
import type {
  InboundMediaMessage,
  InboundStatusUpdate,
  InboundTextMessage,
} from './provider.interface';
import type { JobContext } from '@/server/jobs/registry';

export type DomainEvent =
  | { kind: 'message'; message: InboundTextMessage | InboundMediaMessage }
  | { kind: 'status'; statusUpdate: InboundStatusUpdate };

/**
 * Parses raw JSON payload stored on WebhookEvent into normalized domain DTOs.
 */
export function parseLogicalEventToDomain(
  eventType: string,
  rawPayload: unknown,
): DomainEvent | null {
  if (typeof rawPayload !== 'object' || rawPayload === null) {
    return null;
  }

  const payload = rawPayload as Record<string, unknown>;

  if (eventType === 'message') {
    const providerMessageId = typeof payload.id === 'string' ? payload.id : null;
    const rawFrom = typeof payload.from === 'string' ? payload.from : null;
    if (!providerMessageId || !rawFrom) return null;

    const fromPhone = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`;
    const occurredAt =
      typeof payload.timestamp === 'string' || typeof payload.timestamp === 'number'
        ? new Date(Number(payload.timestamp) * 1000)
        : new Date();

    const contextObj =
      typeof payload.context === 'object' && payload.context !== null
        ? (payload.context as Record<string, unknown>)
        : null;
    const replyToProviderMessageId =
      contextObj && typeof contextObj.id === 'string' ? contextObj.id : null;

    const contactsArr = Array.isArray(payload.contacts) ? payload.contacts : [];
    const firstContact =
      contactsArr.length > 0 && typeof contactsArr[0] === 'object' && contactsArr[0] !== null
        ? (contactsArr[0] as Record<string, unknown>)
        : null;
    const profileObj =
      firstContact && typeof firstContact.profile === 'object' && firstContact.profile !== null
        ? (firstContact.profile as Record<string, unknown>)
        : null;
    const waProfileName =
      profileObj && typeof profileObj.name === 'string' ? profileObj.name : null;

    const msgType = typeof payload.type === 'string' ? payload.type.toLowerCase() : 'text';

    if (msgType === 'text') {
      const textObj =
        typeof payload.text === 'object' && payload.text !== null
          ? (payload.text as Record<string, unknown>)
          : null;
      const body = textObj && typeof textObj.body === 'string' ? textObj.body : '';
      return {
        kind: 'message',
        message: {
          type: 'TEXT',
          providerMessageId,
          fromPhone,
          waProfileName,
          body,
          occurredAt,
          replyToProviderMessageId,
        },
      };
    }

    if (['image', 'document', 'audio', 'video'].includes(msgType)) {
      const mediaKind = msgType.toUpperCase() as 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
      const mediaObj =
        typeof payload[msgType] === 'object' && payload[msgType] !== null
          ? (payload[msgType] as Record<string, unknown>)
          : null;

      const caption = mediaObj && typeof mediaObj.caption === 'string' ? mediaObj.caption : null;
      const mimeType = mediaObj && typeof mediaObj.mime_type === 'string' ? mediaObj.mime_type : 'application/octet-stream';
      const fileName = mediaObj && typeof mediaObj.filename === 'string' ? mediaObj.filename : null;
      const mediaUrl = mediaObj && typeof mediaObj.id === 'string' ? mediaObj.id : null;

      return {
        kind: 'message',
        message: {
          type: mediaKind,
          providerMessageId,
          fromPhone,
          waProfileName,
          mediaUrl,
          mimeType,
          fileName,
          caption,
          occurredAt,
          replyToProviderMessageId,
        },
      };
    }

    // Fallbacks for other WhatsApp message types (sticker, location, interactive, reaction)
    let body = `[${msgType} message]`;
    if (msgType === 'sticker') body = '[Sticker]';
    if (msgType === 'location') body = '[Location shared]';
    if (msgType === 'interactive') body = '[Interactive reply]';
    if (msgType === 'reaction') body = '[Reaction]';

    return {
      kind: 'message',
      message: {
        type: 'TEXT',
        providerMessageId,
        fromPhone,
        waProfileName,
        body,
        occurredAt,
        replyToProviderMessageId,
      },
    };
  }

  if (eventType === 'status') {
    const providerMessageId = typeof payload.id === 'string' ? payload.id : null;
    const rawStatus = typeof payload.status === 'string' ? payload.status.toUpperCase() : null;
    if (!providerMessageId || !rawStatus) return null;

    const validStatuses = ['SENT', 'DELIVERED', 'READ', 'FAILED'];
    if (!validStatuses.includes(rawStatus)) return null;

    const occurredAt =
      typeof payload.timestamp === 'string' || typeof payload.timestamp === 'number'
        ? new Date(Number(payload.timestamp) * 1000)
        : new Date();

    const errorsArr = Array.isArray(payload.errors) ? payload.errors : [];
    const firstErr =
      errorsArr.length > 0 && typeof errorsArr[0] === 'object' && errorsArr[0] !== null
        ? (errorsArr[0] as Record<string, unknown>)
        : null;

    const errorCode = firstErr && firstErr.code !== undefined ? String(firstErr.code) : null;
    const errorMessage = firstErr && typeof firstErr.title === 'string' ? firstErr.title : null;

    return {
      kind: 'status',
      statusUpdate: {
        type: 'STATUS',
        providerMessageId,
        status: rawStatus as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
        occurredAt,
        errorCode,
        errorMessage,
      },
    };
  }

  return null;
}

/**
 * Main execution function for `whatsapp.process_webhook` background jobs.
 */
export async function processWebhookEvent(
  webhookEventId: string,
  context: JobContext,
): Promise<void> {
  const webhookEvent = await findWebhookEventById(prisma, webhookEventId);
  if (!webhookEvent) {
    throw new NotFoundError(`WebhookEvent with id "${webhookEventId}"`);
  }

  // Idempotency: If event was already successfully processed or ignored, exit cleanly
  if (webhookEvent.status === 'PROCESSED' || webhookEvent.status === 'IGNORED') {
    logger.info('whatsapp.webhook.job_already_handled', {
      jobId: context.jobId,
      webhookEventId,
      status: webhookEvent.status,
    });
    return;
  }

  // Set state to PROCESSING
  await updateWebhookEventStatus(prisma, webhookEventId, { status: 'PROCESSING' });

  // 1. Tenant Resolution from phoneNumberId
  if (!webhookEvent.phoneNumberId) {
    await updateWebhookEventStatus(prisma, webhookEventId, {
      status: 'IGNORED',
      error: 'Missing phone_number_id in webhook event',
      processedAt: new Date(),
    });
    logger.info('whatsapp.webhook.ignored_missing_phone_number_id', {
      jobId: context.jobId,
      webhookEventId,
    });
    await appendAuditLog(prisma, {
      action: 'whatsapp.webhook.ignored',
      actorType: 'SYSTEM',
      metadata: { webhookEventId, reason: 'Missing phone_number_id' },
    });
    return;
  }

  const phone = await findPhoneNumberWithAccountByPhoneNumberId(
    prisma,
    webhookEvent.phoneNumberId,
  );

  if (!phone) {
    await updateWebhookEventStatus(prisma, webhookEventId, {
      status: 'IGNORED',
      error: `Unknown phone_number_id: ${webhookEvent.phoneNumberId}`,
      processedAt: new Date(),
    });
    logger.info('whatsapp.webhook.ignored_unknown_phone_number', {
      jobId: context.jobId,
      webhookEventId,
      phoneNumberId: webhookEvent.phoneNumberId,
    });
    await appendAuditLog(prisma, {
      action: 'whatsapp.webhook.ignored',
      actorType: 'SYSTEM',
      metadata: {
        webhookEventId,
        phoneNumberId: webhookEvent.phoneNumberId,
        reason: 'Unknown phone_number_id',
      },
    });
    return;
  }

  if (phone.status !== 'CONNECTED' || phone.account.status !== 'CONNECTED') {
    await updateWebhookEventStatus(prisma, webhookEventId, {
      status: 'IGNORED',
      workspaceId: phone.workspaceId,
      error: `Channel or account not connected (phone: ${phone.status}, account: ${phone.account.status})`,
      processedAt: new Date(),
    });
    logger.warn('whatsapp.webhook.ignored_channel_not_connected', {
      jobId: context.jobId,
      webhookEventId,
      workspaceId: phone.workspaceId,
      phoneStatus: phone.status,
      accountStatus: phone.account.status,
    });
    await appendAuditLog(prisma, {
      action: 'whatsapp.webhook.ignored',
      workspaceId: phone.workspaceId,
      actorType: 'SYSTEM',
      metadata: {
        webhookEventId,
        reason: 'Channel or account not connected',
        phoneStatus: phone.status,
        accountStatus: phone.account.status,
      },
    });
    return;
  }

  const workspaceId = phone.workspaceId;
  await updateWebhookEventStatus(prisma, webhookEventId, { workspaceId });

  // 2. Event Parsing
  const domainEvent = parseLogicalEventToDomain(
    webhookEvent.eventType,
    webhookEvent.payload,
  );

  if (!domainEvent) {
    await updateWebhookEventStatus(prisma, webhookEventId, {
      status: 'IGNORED',
      error: `Unsupported logical event (type: ${webhookEvent.eventType})`,
      processedAt: new Date(),
    });
    logger.info('whatsapp.webhook.ignored_unsupported_event', {
      jobId: context.jobId,
      webhookEventId,
      workspaceId,
      eventType: webhookEvent.eventType,
    });
    return;
  }

  // 3. Domain Execution
  try {
    if (domainEvent.kind === 'message') {
      const result = await processInboundMessage({ workspaceId }, domainEvent.message);

      await updateWebhookEventStatus(prisma, webhookEventId, {
        status: 'PROCESSED',
        processedAt: new Date(),
        error: null,
      });

      if (!result.isDuplicate) {
        await queue.enqueue(
          'ai.respond',
          {
            workspaceId,
            conversationId: result.conversationId,
            messageId: result.messageId,
          },
          { dedupeKey: `ai.respond:${result.messageId}` },
        );
      }

      logger.info('whatsapp.webhook.message_processed', {
        jobId: context.jobId,
        webhookEventId,
        workspaceId,
        messageId: result.messageId,
        conversationId: result.conversationId,
        isDuplicate: result.isDuplicate,
      });
      return;
    }

    if (domainEvent.kind === 'status') {
      const statusResult = await processStatusUpdate(
        { workspaceId },
        domainEvent.statusUpdate,
      );

      await updateWebhookEventStatus(prisma, webhookEventId, {
        status: 'PROCESSED',
        processedAt: new Date(),
        error: null,
      });

      logger.info('whatsapp.webhook.status_processed', {
        jobId: context.jobId,
        webhookEventId,
        workspaceId,
        status: domainEvent.statusUpdate.status,
        updated: statusResult.updated,
        reason: statusResult.reason,
      });
      return;
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      // Permanent failure due to invalid input
      await updateWebhookEventStatus(prisma, webhookEventId, {
        status: 'FAILED',
        error: error.message,
        processedAt: new Date(),
      });
      logger.error('whatsapp.webhook.validation_failed', {
        jobId: context.jobId,
        webhookEventId,
        workspaceId,
        error: error.message,
      });
      await appendAuditLog(prisma, {
        action: 'whatsapp.webhook.failed',
        workspaceId,
        actorType: 'SYSTEM',
        metadata: { webhookEventId, error: error.message },
      });
      return;
    }

    // Transient failure: update error message and re-throw so job retries via backoff
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateWebhookEventStatus(prisma, webhookEventId, { error: errorMessage });
    throw error;
  }
}
