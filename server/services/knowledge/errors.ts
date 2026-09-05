/**
 * Why an ingestion failed, in the two vocabularies a failure needs.
 *
 * `failureCode` is stable and machine-readable: support greps it, metrics group by it,
 * and the ingest service decides from it whether another attempt is worth queueing.
 * `errorMessage` is the sentence a shop owner reads on the failed row, and it is written
 * for someone who has never heard of an embedding model. The two are kept apart because
 * the moment one column serves both purposes, either the code becomes a sentence nobody
 * can group by or the sentence becomes a code nobody can act on.
 *
 * Nothing here may carry a provider message through to the owner. A provider's error
 * text can contain an API path, a status code, a model name or a truncated key, and the
 * row it lands on is rendered in a browser. So a classification keeps the cause for the
 * log and substitutes its own prose for the screen.
 *
 * Retryability is not decided here from scratch. `classifyAIError` in the agent runtime
 * already answers "could another attempt plausibly succeed?" for provider failures, and
 * a second answer to that question would drift from the first. This module adds only the
 * two things that classifier cannot know: what ingestion's own refusals mean, and which
 * database errors are transient.
 */

import { AppError, NotConfiguredError } from '@/server/errors';
import { classifyAIError, type AIErrorCategory } from '@/server/services/agent/errors';

/**
 * The closed set of reasons stored in `KnowledgeDocument.failureCode`.
 *
 * `AI_UNAVAILABLE` covers any transient dependency, not only the model — a pooler that
 * ran out of connections lands here too, because from the owner's side both are "it
 * didn't work, try again shortly" and both are worth another attempt.
 */
export const KNOWLEDGE_FAILURE_CODES = [
  'CONTENT_EMPTY',
  'CONTENT_TOO_LARGE',
  'AI_UNAVAILABLE',
  'AI_FAILED',
  'NOT_CONFIGURED',
] as const;

export type KnowledgeFailureCode = (typeof KNOWLEDGE_FAILURE_CODES)[number];

/**
 * What each code says on screen.
 *
 * Every sentence names something the owner can either do or wait for. "AI_FAILED" is the
 * hardest of these to write honestly: the cause is on our side, the owner cannot fix it,
 * and pretending their text is at fault would send them editing a document that is fine.
 */
export const KNOWLEDGE_FAILURE_MESSAGES: Record<KnowledgeFailureCode, string> = {
  CONTENT_EMPTY: 'There was nothing to save here. Add some words and try again.',
  CONTENT_TOO_LARGE:
    'This is too long to handle in one piece. Split it into a few shorter documents and try again.',
  AI_UNAVAILABLE: 'We could not finish this just now. Try again in a few minutes.',
  AI_FAILED: 'Something went wrong on our side. Try again, and contact support if it keeps failing.',
  NOT_CONFIGURED:
    'Your assistant is not set up to learn yet. Contact support and we will switch it on.',
};

/**
 * Whether another attempt could plausibly succeed.
 *
 * The two content refusals are deterministic: a retry runs the same code over the same
 * stored text and reaches the same conclusion, so re-queueing would only burn a job slot
 * and leave the row saying "Processing" for longer. `NOT_CONFIGURED` is permanent for the
 * same reason — nobody sets a key up in the ninety seconds before the next attempt.
 */
const KNOWLEDGE_FAILURE_RETRYABLE: Record<KnowledgeFailureCode, boolean> = {
  CONTENT_EMPTY: false,
  CONTENT_TOO_LARGE: false,
  AI_UNAVAILABLE: true,
  AI_FAILED: false,
  NOT_CONFIGURED: false,
};

/**
 * Each code in the agent runtime's category vocabulary, so a log query for
 * `PROVIDER_UNAVAILABLE` finds a stalled ingestion as well as a stalled reply.
 *
 * The two content codes are rule rejections rather than failures: the source was read
 * successfully and refused, which is the same shape as an order refused for insufficient
 * stock. A missing configuration is a provider that is unavailable in the most complete
 * sense — it was never there.
 */
const KNOWLEDGE_FAILURE_CATEGORY: Record<KnowledgeFailureCode, AIErrorCategory> = {
  CONTENT_EMPTY: 'BUSINESS_RULE_REJECTION',
  CONTENT_TOO_LARGE: 'BUSINESS_RULE_REJECTION',
  AI_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  AI_FAILED: 'MALFORMED_RESPONSE',
  NOT_CONFIGURED: 'PROVIDER_UNAVAILABLE',
};

/**
 * Ingestion's own refusal, thrown where the reason is already known precisely.
 *
 * 422 rather than 500: the request was understood and rejected, and for the two content
 * codes the source really is the problem. It is an `AppError` so that a refusal reaching
 * a server action — a retry of a document whose text cannot be chunked, say — is already
 * shaped for the response envelope instead of arriving as an unknown throw.
 */
export class KnowledgeIngestFailure extends AppError {
  readonly code = 'KNOWLEDGE_INGEST_FAILED';
  readonly status = 422;
  readonly failureCode: KnowledgeFailureCode;

  constructor(failureCode: KnowledgeFailureCode, options: { cause?: unknown } = {}) {
    super(KNOWLEDGE_FAILURE_MESSAGES[failureCode], options);
    this.failureCode = failureCode;
  }
}

export type KnowledgeFailureClassification = {
  readonly failureCode: KnowledgeFailureCode;
  /** Safe to store in `errorMessage` and render. Never the provider's own words. */
  readonly message: string;
  readonly retryable: boolean;
  /** The agent runtime's vocabulary, so one log query covers ingestion and chat alike. */
  readonly category: AIErrorCategory;
};

/**
 * Postgres and Prisma conditions that mean "the same statement may well work next time".
 *
 * Deliberately a closed list. Treating an unrecognised database error as transient would
 * retry a constraint violation five times and then report a transient failure for what is
 * actually a bug, so anything not named here is permanent and gets looked at.
 */
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // cannot reach the database server
  'P1002', // reached it, and it timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // timed out taking a connection from the pool
  'P2034', // write conflict or deadlock, retry the transaction
]);

const TRANSIENT_POSTGRES_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '55P03', // lock_not_available
  '57014', // query_canceled, i.e. the statement timeout fired
]);

/** Reads a string property off an unknown throw without asserting its shape. */
function stringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value)) return null;
  const held: unknown = Reflect.get(value, key);
  return typeof held === 'string' ? held : null;
}

/**
 * `PrismaClientKnownRequestError` is matched structurally rather than with `instanceof`.
 *
 * Raw queries fail as `P2010` whatever went wrong underneath, so the driver's own SQLSTATE
 * in `meta.code` is the only thing that separates a deadlock from a syntax error — and the
 * vector insert this module exists to serve is a raw query.
 */
function isTransientDatabaseError(error: unknown): boolean {
  const prismaCode = stringProperty(error, 'code');
  if (prismaCode !== null && TRANSIENT_PRISMA_CODES.has(prismaCode)) return true;

  const meta: unknown = typeof error === 'object' && error !== null && 'meta' in error
    ? Reflect.get(error, 'meta')
    : null;
  const postgresCode = stringProperty(meta, 'code');
  return postgresCode !== null && TRANSIENT_POSTGRES_CODES.has(postgresCode);
}

/**
 * Turns anything thrown during ingestion into a code, a sentence and a retry decision.
 *
 * The order matters: ingestion's own refusals already know their code, a missing
 * configuration is recognisable by type, transient database errors are recognisable by
 * SQLSTATE, and everything left is a provider failure that `classifyAIError` is already
 * the authority on.
 */
export function classifyIngestFailure(error: unknown): KnowledgeFailureClassification {
  if (error instanceof KnowledgeIngestFailure) {
    return {
      failureCode: error.failureCode,
      message: error.message,
      retryable: KNOWLEDGE_FAILURE_RETRYABLE[error.failureCode],
      category: KNOWLEDGE_FAILURE_CATEGORY[error.failureCode],
    };
  }

  if (error instanceof NotConfiguredError) {
    return {
      failureCode: 'NOT_CONFIGURED',
      message: KNOWLEDGE_FAILURE_MESSAGES.NOT_CONFIGURED,
      retryable: false,
      category: KNOWLEDGE_FAILURE_CATEGORY.NOT_CONFIGURED,
    };
  }

  if (isTransientDatabaseError(error)) {
    return {
      failureCode: 'AI_UNAVAILABLE',
      message: KNOWLEDGE_FAILURE_MESSAGES.AI_UNAVAILABLE,
      retryable: true,
      category: KNOWLEDGE_FAILURE_CATEGORY.AI_UNAVAILABLE,
    };
  }

  const classified = classifyAIError(error);
  const retryable = classified.retryability === 'RETRYABLE';

  return {
    failureCode: retryable ? 'AI_UNAVAILABLE' : 'AI_FAILED',
    message: retryable
      ? KNOWLEDGE_FAILURE_MESSAGES.AI_UNAVAILABLE
      : KNOWLEDGE_FAILURE_MESSAGES.AI_FAILED,
    retryable,
    category: classified.category,
  };
}
