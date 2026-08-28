/**
 * WhatsApp Webhook Parser and Persistence Service.
 *
 * Flattens Meta webhook change entries into logical events (messages, statuses,
 * or unknown structures) and atomically persists each WebhookEvent alongside
 * its background processing Job.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { isUniqueConstraintViolation, prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { insertJob } from '@/server/repositories/job.repository';

export type LogicalWebhookEvent = {
  type: 'message' | 'status' | 'unknown';
  phoneNumberId: string | null;
  providerEventId: string;
  payload: Record<string, unknown>;
};

/**
 * Safely flattens:
 *   entry[] -> changes[] -> value.messages[] / statuses[]
 * into normalized logical events.
 *
 * Unknown or malformed structures are captured as type 'unknown' and will never throw.
 */
export function extractLogicalEvents(payload: unknown): LogicalWebhookEvent[] {
  if (typeof payload !== 'object' || payload === null) {
    return [
      {
        type: 'unknown',
        phoneNumberId: null,
        providerEventId: `unknown:${randomUUID()}`,
        payload: { raw: payload },
      },
    ];
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.entry) || record.entry.length === 0) {
    return [
      {
        type: 'unknown',
        phoneNumberId: null,
        providerEventId: `unknown:${randomUUID()}`,
        payload: record,
      },
    ];
  }

  const events: LogicalWebhookEvent[] = [];

  for (const entry of record.entry) {
    if (typeof entry !== 'object' || entry === null) {
      events.push({
        type: 'unknown',
        phoneNumberId: null,
        providerEventId: `unknown:${randomUUID()}`,
        payload: { raw: entry },
      });
      continue;
    }

    const entryObj = entry as Record<string, unknown>;
    if (!Array.isArray(entryObj.changes) || entryObj.changes.length === 0) {
      events.push({
        type: 'unknown',
        phoneNumberId: null,
        providerEventId:
          typeof entryObj.id === 'string' ? `unknown:${entryObj.id}` : `unknown:${randomUUID()}`,
        payload: entryObj,
      });
      continue;
    }

    for (const change of entryObj.changes) {
      if (typeof change !== 'object' || change === null) {
        events.push({
          type: 'unknown',
          phoneNumberId: null,
          providerEventId: `unknown:${randomUUID()}`,
          payload: { raw: change },
        });
        continue;
      }

      const changeObj = change as Record<string, unknown>;
      const value = changeObj.value;
      if (typeof value !== 'object' || value === null) {
        events.push({
          type: 'unknown',
          phoneNumberId: null,
          providerEventId: `unknown:${randomUUID()}`,
          payload: changeObj,
        });
        continue;
      }

      const valueObj = value as Record<string, unknown>;
      const metadata = valueObj.metadata as Record<string, unknown> | undefined;
      const phoneNumberId =
        metadata && typeof metadata.phone_number_id === 'string'
          ? metadata.phone_number_id
          : null;

      let extractedAny = false;

      // Extract messages
      if (Array.isArray(valueObj.messages)) {
        for (const message of valueObj.messages) {
          const msgObj = typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : null;
          if (msgObj && typeof msgObj.id === 'string' && msgObj.id.length > 0) {
            events.push({
              type: 'message',
              phoneNumberId,
              providerEventId: msgObj.id,
              payload: {
                ...msgObj,
                metadata: valueObj.metadata,
                contacts: valueObj.contacts,
              },
            });
            extractedAny = true;
          } else {
            events.push({
              type: 'unknown',
              phoneNumberId,
              providerEventId: `unknown:${randomUUID()}`,
              payload: {
                message,
                metadata: valueObj.metadata,
              },
            });
            extractedAny = true;
          }
        }
      }

      // Extract statuses
      if (Array.isArray(valueObj.statuses)) {
        for (const status of valueObj.statuses) {
          const stObj = typeof status === 'object' && status !== null ? (status as Record<string, unknown>) : null;
          if (
            stObj &&
            typeof stObj.id === 'string' &&
            stObj.id.length > 0 &&
            typeof stObj.status === 'string'
          ) {
            events.push({
              type: 'status',
              phoneNumberId,
              providerEventId: `${stObj.id}:${stObj.status}`,
              payload: {
                ...stObj,
                metadata: valueObj.metadata,
              },
            });
            extractedAny = true;
          } else {
            events.push({
              type: 'unknown',
              phoneNumberId,
              providerEventId: `unknown:${randomUUID()}`,
              payload: {
                status,
                metadata: valueObj.metadata,
              },
            });
            extractedAny = true;
          }
        }
      }

      // If change contains neither messages nor statuses, capture as unknown
      if (!extractedAny) {
        events.push({
          type: 'unknown',
          phoneNumberId,
          providerEventId: `unknown:${randomUUID()}`,
          payload: changeObj,
        });
      }
    }
  }

  return events.length > 0
    ? events
    : [
        {
          type: 'unknown',
          phoneNumberId: null,
          providerEventId: `unknown:${randomUUID()}`,
          payload: record,
        },
      ];
}

/**
 * Atomically inserts a WebhookEvent and enqueues its background processing Job.
 *
 * If a unique constraint violation occurs on WebhookEvent (provider + providerEventId),
 * the error is caught, logged as a duplicate, and returns { created: false }.
 */
export async function persistLogicalEvent(
  event: LogicalWebhookEvent,
): Promise<{ created: boolean; webhookEventId?: string }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const webhookEvent = await tx.webhookEvent.create({
        data: {
          provider: 'whatsapp',
          providerEventId: event.providerEventId,
          workspaceId: null,
          phoneNumberId: event.phoneNumberId,
          eventType: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          signatureValid: true,
          status: 'RECEIVED',
        },
        select: { id: true },
      });

      await insertJob(tx, {
        type: 'whatsapp.process_webhook',
        payload: { webhookEventId: webhookEvent.id },
        workspaceId: null,
        runAfter: new Date(),
        maxAttempts: 8,
        priority: 90,
        dedupeKey: `whatsapp.process_webhook:${webhookEvent.id}`,
      });

      return webhookEvent.id;
    });

    logger.info('whatsapp.webhook.event_ingested', {
      providerEventId: event.providerEventId,
      phoneNumberId: event.phoneNumberId,
      eventType: event.type,
    });

    return { created: true, webhookEventId: result };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      logger.info('whatsapp.webhook.duplicate_event_ignored', {
        providerEventId: event.providerEventId,
        eventType: event.type,
      });
      return { created: false };
    }

    logger.error('whatsapp.webhook.persistence_failed', {
      providerEventId: event.providerEventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
