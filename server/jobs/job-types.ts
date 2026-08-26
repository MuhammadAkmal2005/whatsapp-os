/**
 * The catalogue of background job types and their payload schemas.
 *
 * Every job type is declared here with a Zod schema for its payload. That gives
 * two things worth the ceremony:
 *
 *  1. `enqueue` is typed. Passing the wrong payload shape for a job type is a
 *     compile error, not a runtime failure discovered by a worker at midnight.
 *  2. Payloads are re-validated on the way *out* of the database. A job row can
 *     be months old, written by a previous deployment whose payload shape has
 *     since changed. Parsing on dequeue turns that into a clean, logged failure
 *     for one job instead of a `TypeError` that kills the worker loop.
 *
 * Payloads carry ids, never whole objects. A job that embeds a copy of an order
 * will eventually act on stale data; a job that carries `orderId` reads the
 * current row when it runs.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

/**
 * `workspaceId` is part of the payload for every tenant-scoped job.
 *
 * A worker has no session and no cookie, so it cannot resolve a tenant context
 * the way a request does. The payload is the only place the scope can come from,
 * which makes it the one legitimate exception to "never take workspaceId from
 * input" — the value was written by trusted server code that had already proven
 * membership, not by a client. Handlers must still pass it to a repository and
 * must never widen a query beyond it.
 */
const tenantScoped = z.object({ workspaceId: uuid });

export const JOB_PAYLOAD_SCHEMAS = {
  /** Deliver one queued outbound WhatsApp message via the provider. */
  'whatsapp.send_message': tenantScoped.extend({ messageId: uuid }),

  /** Process one stored webhook event. Enqueued by the webhook route so the HTTP
   *  response is fast and Meta does not retry on our processing latency. */
  'whatsapp.process_webhook': z.object({ webhookEventId: uuid }),

  /** Download inbound media from the provider into our own storage, because the
   *  provider's media URLs expire. */
  'whatsapp.download_media': tenantScoped.extend({ attachmentId: uuid }),

  /** Run the AI agent over a conversation that has a new inbound message. */
  'ai.respond': tenantScoped.extend({ conversationId: uuid, messageId: uuid }),

  /** Refresh a conversation's rolling summary once the recent-message window has
   *  moved far enough that the summary is stale. */
  'ai.summarise_conversation': tenantScoped.extend({ conversationId: uuid }),

  /** Extract, chunk and embed an uploaded knowledge document. */
  'knowledge.ingest_document': tenantScoped.extend({ documentId: uuid }),

  /** Re-embed chunks after an embedding-model change. */
  'knowledge.embed_chunks': tenantScoped.extend({
    documentId: uuid,
    chunkIds: z.array(uuid).min(1).max(100),
  }),

  /** Evaluate one automation against one trigger occurrence. */
  'automation.run': tenantScoped.extend({
    automationId: uuid,
    triggerContext: z.record(z.string(), z.unknown()).default({}),
  }),

  /** The delayed half of a wait-then-act automation. */
  'automation.resume': tenantScoped.extend({ runId: uuid, actionIndex: z.number().int().min(0) }),

  /** Fan a campaign out into per-recipient sends. Gated by ENABLE_CAMPAIGNS. */
  'campaign.dispatch': tenantScoped.extend({ campaignId: uuid }),
  'campaign.send_recipient': tenantScoped.extend({ recipientId: uuid }),

  /** Appointment reminder. Gated by ENABLE_APPOINTMENTS. */
  'appointment.remind': tenantScoped.extend({ appointmentId: uuid }),

  /** Roll the previous day's events into AnalyticsDaily. */
  'analytics.rollup_daily': z.object({ date: z.string().date(), workspaceId: uuid.optional() }),

  /** Housekeeping: elapsed rate-limit buckets, expired sessions, dead jobs. */
  'maintenance.sweep': z.object({}),

  /** Deliver a queued notification through its channel. */
  'notification.deliver': tenantScoped.extend({ notificationId: uuid }),
} as const satisfies Record<string, z.ZodType>;

export type JobType = keyof typeof JOB_PAYLOAD_SCHEMAS;

export type JobPayload<T extends JobType> = z.infer<(typeof JOB_PAYLOAD_SCHEMAS)[T]>;

/** The payload as the caller supplies it, before Zod defaults are applied. */
export type JobPayloadInput<T extends JobType> = z.input<(typeof JOB_PAYLOAD_SCHEMAS)[T]>;

export const JOB_TYPES = Object.keys(JOB_PAYLOAD_SCHEMAS) as JobType[];

export function isJobType(value: string): value is JobType {
  return Object.hasOwn(JOB_PAYLOAD_SCHEMAS, value);
}

/**
 * Parses a payload read back from the database.
 *
 * Returns a result rather than throwing so the worker can mark exactly one job
 * dead and carry on. An unparseable payload is never retried — retrying will not
 * make it parse — so this failure goes straight to the dead letter state.
 */
export function parseJobPayload(
  type: JobType,
  raw: unknown,
): { ok: true; payload: JobPayload<JobType> } | { ok: false; message: string } {
  const result = JOB_PAYLOAD_SCHEMAS[type].safeParse(raw);
  if (result.success) return { ok: true, payload: result.data as JobPayload<JobType> };

  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, message: `Invalid payload for ${type}: ${message}` };
}

/**
 * Per-type overrides for attempt budget and priority.
 *
 * The defaults are five attempts at priority zero. The overrides encode how much
 * a given failure matters: a customer waiting on a WhatsApp reply is the most
 * urgent thing in the system, whereas an analytics rollup can wait and will be
 * recomputed by tomorrow's run anyway, so burning retries on it is pointless.
 */
export const JOB_DEFAULTS: Partial<Record<JobType, { maxAttempts?: number; priority?: number }>> = {
  'whatsapp.send_message': { maxAttempts: 8, priority: 100 },
  'whatsapp.process_webhook': { maxAttempts: 8, priority: 90 },
  'ai.respond': { maxAttempts: 3, priority: 80 },
  'whatsapp.download_media': { maxAttempts: 5, priority: 40 },
  'notification.deliver': { maxAttempts: 5, priority: 60 },
  'automation.resume': { maxAttempts: 5, priority: 50 },
  'knowledge.ingest_document': { maxAttempts: 3, priority: 20 },
  'knowledge.embed_chunks': { maxAttempts: 3, priority: 20 },
  'analytics.rollup_daily': { maxAttempts: 2, priority: -10 },
  'maintenance.sweep': { maxAttempts: 1, priority: -20 },
};
