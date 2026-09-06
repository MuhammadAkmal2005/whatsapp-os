/**
 * Telemetry for the Meta WhatsApp integration.
 *
 * One module so the event names exist in exactly one place and a dashboard query
 * cannot be broken by a typo at a call site. Each emitter does three things: increments
 * a Prometheus counter, writes a structured log line, and — where a workspace owns the
 * event — appends a `ProductEvent` row so the fact survives a log rotation.
 *
 * The property type is a closed union of primitives, and every emitter takes a
 * purpose-built argument object rather than an open record. That is the mechanism
 * preventing an access token from ever reaching a telemetry payload: there is no field
 * to put one in. `MetaTelemetryProps` explicitly forbids the words a secret would
 * arrive under, so `properties: { accessToken }` is a compile error rather than a
 * review catch.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { appendProductEvent } from '@/server/repositories/audit.repository';
import { metricsRegistry } from '@/server/telemetry/metrics';

/** Connection method, mirrored from the Prisma enum without importing it. */
export type MetaConnectionMethodLabel = 'MANUAL_TOKEN' | 'EMBEDDED_SIGNUP' | 'MOCK';

type Primitive = string | number | boolean | null;

/**
 * Any extra property a Meta telemetry event may carry.
 *
 * The `never` fields are the point of the type. A secret has to be *named* to be
 * attached, and every plausible name is closed off.
 */
export type MetaTelemetryProps = Record<string, Primitive> & {
  accessToken?: never;
  access_token?: never;
  token?: never;
  appSecret?: never;
  app_secret?: never;
  code?: never;
  pin?: never;
  authorizationCode?: never;
};

export const META_EVENT = {
  connectionStarted: 'meta_connection_started',
  connectionSucceeded: 'meta_connection_succeeded',
  connectionFailed: 'meta_connection_failed',
  connectionHealthFailed: 'meta_connection_health_failed',
  webhookReceived: 'meta_webhook_received',
  webhookRejected: 'meta_webhook_rejected',
  messageReceived: 'meta_message_received',
  messageSent: 'meta_message_sent',
  messageFailed: 'meta_message_failed',
} as const;

export type MetaEventName = (typeof META_EVENT)[keyof typeof META_EVENT];

async function record(
  db: Db | null,
  name: MetaEventName,
  workspaceId: string | null,
  properties: MetaTelemetryProps,
): Promise<void> {
  logger.info(name, { workspaceId, ...properties });

  if (!db || !workspaceId) return;
  try {
    await appendProductEvent(db, { name, workspaceId, properties });
  } catch (error) {
    // Telemetry must never be the reason a connection or a customer reply fails.
    logger.warn('meta.telemetry.persist_failed', {
      event: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Connection lifecycle ───────────────────────────────────────────────────

export async function emitConnectionStarted(
  db: Db,
  params: { workspaceId: string; method: MetaConnectionMethodLabel },
): Promise<void> {
  metricsRegistry.metaConnectionEvents.inc({ event: 'started', method: params.method });
  await record(db, META_EVENT.connectionStarted, params.workspaceId, { method: params.method });
}

export async function emitConnectionSucceeded(
  db: Db,
  params: {
    workspaceId: string;
    method: MetaConnectionMethodLabel;
    /** Meta ids are not secrets — they are shown in Business Manager — and they are
     *  the only way to correlate a support question with a Meta-side record. */
    wabaId: string;
    phoneNumberId: string;
    subscribed: boolean;
    registered: boolean;
  },
): Promise<void> {
  metricsRegistry.metaConnectionEvents.inc({ event: 'succeeded', method: params.method });
  await record(db, META_EVENT.connectionSucceeded, params.workspaceId, {
    method: params.method,
    wabaId: params.wabaId,
    phoneNumberId: params.phoneNumberId,
    subscribed: params.subscribed,
    registered: params.registered,
  });
}

export async function emitConnectionFailed(
  db: Db,
  params: {
    workspaceId: string;
    method: MetaConnectionMethodLabel;
    /** The stage that failed, so a failure is actionable without reading a stack. */
    stage: 'token_exchange' | 'asset_verification' | 'subscription' | 'registration' | 'persistence';
    errorCode: string;
  },
): Promise<void> {
  metricsRegistry.metaConnectionEvents.inc({ event: 'failed', method: params.method });
  await record(db, META_EVENT.connectionFailed, params.workspaceId, {
    method: params.method,
    stage: params.stage,
    errorCode: params.errorCode,
  });
}

export async function emitConnectionHealthFailed(
  db: Db,
  params: { workspaceId: string; accountId: string; reason: string },
): Promise<void> {
  metricsRegistry.metaConnectionEvents.inc({ event: 'health_failed', method: 'unknown' });
  await record(db, META_EVENT.connectionHealthFailed, params.workspaceId, {
    accountId: params.accountId,
    reason: params.reason,
  });
}

// ── Webhook ingestion ──────────────────────────────────────────────────────

/**
 * Synchronous and log-only on purpose.
 *
 * These fire on Meta's delivery path, before a tenant is known, at whatever rate Meta
 * chooses. A database write per webhook would add a round trip to every event and give
 * a burst the ability to exhaust the connection pool.
 */
export function emitWebhookReceived(params: { eventCount: number }): void {
  metricsRegistry.webhookEvents.inc({ provider: 'whatsapp', eventType: 'batch', status: 'received' });
  logger.info(META_EVENT.webhookReceived, { eventCount: params.eventCount });
}

export function emitWebhookRejected(params: { reason: string }): void {
  metricsRegistry.webhookEvents.inc({ provider: 'whatsapp', eventType: 'batch', status: 'rejected' });
  metricsRegistry.securityViolations.inc({ type: 'meta_webhook_rejected' });
  logger.warn(META_EVENT.webhookRejected, { reason: params.reason });
}

// ── Message flow ───────────────────────────────────────────────────────────

export async function emitMessageReceived(
  db: Db,
  params: { workspaceId: string; messageType: string },
): Promise<void> {
  metricsRegistry.metaMessages.inc({ direction: 'inbound', outcome: 'received' });
  await record(db, META_EVENT.messageReceived, params.workspaceId, {
    messageType: params.messageType,
  });
}

export async function emitMessageSent(
  db: Db,
  params: { workspaceId: string; messageType: string },
): Promise<void> {
  metricsRegistry.metaMessages.inc({ direction: 'outbound', outcome: 'sent' });
  await record(db, META_EVENT.messageSent, params.workspaceId, {
    messageType: params.messageType,
  });
}

export async function emitMessageFailed(
  db: Db,
  params: {
    workspaceId: string;
    messageType: string;
    errorCode: string;
    /** NOT_SENT_RETRYABLE, NOT_SENT_PERMANENT, or UNCERTAIN. */
    classification: string;
  },
): Promise<void> {
  metricsRegistry.metaMessages.inc({
    direction: 'outbound',
    outcome: params.classification === 'UNCERTAIN' ? 'uncertain' : 'failed',
  });
  await record(db, META_EVENT.messageFailed, params.workspaceId, {
    messageType: params.messageType,
    errorCode: params.errorCode,
    classification: params.classification,
  });
}
