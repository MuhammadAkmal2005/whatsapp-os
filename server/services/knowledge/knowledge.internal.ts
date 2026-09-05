/**
 * Shared internals for the knowledge services.
 *
 * Two services need the same five things: the CRUD service that a person drives, and the
 * ingestion service a worker drives. They are separate files because they answer to
 * different callers with different failure modes — a form post that must return a message,
 * and a job that must decide whether to retry — but the pieces below are single
 * definitions on purpose. Two copies of a dedupe key format is two keys.
 *
 * Not exported outside `server/services/knowledge/`. Nothing here is a public API.
 */

import 'server-only';

import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { NotFoundError } from '@/server/errors';
import { dedupeKey, queue } from '@/server/jobs';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { releaseDeadJobDedupeKey } from '@/server/repositories/job.repository';
import {
  findKnowledgeDocumentById,
  markDocumentFailed,
  type KnowledgeDocumentRow,
} from '@/server/repositories/knowledge.repository';
import {
  KNOWLEDGE_FAILURE_MESSAGES,
  KnowledgeIngestFailure,
} from '@/server/services/knowledge/errors';
import type { TenantContext } from '@/server/tenancy/context';
import { utf8ByteLength } from '@/server/validation/knowledge';

export type AuditMeta = { ipAddress?: string | null; userAgent?: string | null };

/** A zero row count from a workspace-scoped write means the id was not in this workspace.
 *  NotFound, never Forbidden — a 403 confirms the id exists somewhere else and turns the
 *  endpoint into an oracle for another business's document ids. */
export function assertTouched(count: number): void {
  if (count === 0) throw new NotFoundError('Knowledge');
}

/**
 * Confirms the document is in this workspace, and returns it with its source text.
 *
 * The repository already filters on `workspaceId`, so this is the redundant layer rather
 * than the only one. It is worth writing anyway: the row is about to be chunked, embedded
 * and re-published, and a mistake in the query above would put one business's return
 * policy into another's assistant.
 */
export async function loadKnowledgeDocument(
  ctx: TenantContext,
  documentId: string,
): Promise<KnowledgeDocumentRow> {
  const document = await findKnowledgeDocumentById(prisma, ctx, documentId);
  if (!document) throw new NotFoundError('Knowledge');
  return document;
}

/**
 * What the corpus is *meant* to be built with, for the knowledge base row.
 *
 * Read from configuration rather than from the embedding provider, and the difference
 * matters twice. A business can add a document before the assistant has been switched on,
 * and asking the factory for a provider would refuse the save over something that is only
 * a problem later — ingestion is where a missing configuration belongs, and it has a
 * failure code for it. And when the mock provider is in use, its vectors are labelled as
 * the mock's on each chunk, while the workspace's *intent* is still the configured model;
 * writing the mock's name here would make a test seam look like a decision.
 */
export function intendedEmbeddingModel(): string {
  return env.AI_EMBEDDING_MODEL;
}

/**
 * The stored size of a document's source, in bytes.
 *
 * Counted over the text that becomes evidence, not over the row: the title is how an owner
 * finds the document and is not part of what the assistant reads back, so including it
 * would make two documents with the same body differ in size for no reason a person could
 * see. UTF-8 rather than character length because the number is meant to answer "how much
 * room is this taking", and in Urdu a character is two bytes.
 */
export function sourceByteSize(
  source: { readonly content: string } | { readonly question: string; readonly answer: string },
): number {
  return 'content' in source
    ? utf8ByteLength(source.content)
    : utf8ByteLength(source.question) + utf8ByteLength(source.answer);
}

/**
 * One key per document, so two saves of the same document are one job.
 *
 * The workspace is in the key even though the document id is already unique, because the
 * column's unique constraint is global: a key that names only an entity is a key another
 * tenant's row could in principle occupy, and reading it back is how you find out.
 */
export function ingestDedupeKey(workspaceId: string, documentId: string): string {
  return dedupeKey('knowledge.ingest_document', workspaceId, documentId);
}

/**
 * Queues one ingestion attempt, releasing a spent key first.
 *
 * The release is not optional and is not only for Retry. A dead job keeps its dedupe key
 * so that a person can see it, which means `insertJob` answers a later enqueue under the
 * same key with the dead job itself and `created: false` — so without this, the second
 * time a document ever failed terminally, Retry and Save would both appear to do nothing
 * for the rest of that document's life. It runs on every path, including a first create
 * where there is nothing to release, because a key lookup costs one indexed update and
 * remembering which paths need it does not stay correct.
 *
 * Called after the transaction that saved the document has committed, never inside it. The
 * queue writes through its own client, so an enqueue enrolled in a transaction that later
 * rolled back would leave a job pointing at a document that does not exist. The cost of
 * that ordering is the opposite gap — a crash between the commit and the enqueue leaves a
 * document waiting with no job — which is why the failure below is recorded on the row
 * rather than swallowed: the owner sees that it did not go through, and Retry is a button
 * that works.
 */
export async function scheduleIngest(
  workspaceId: string,
  documentId: string,
): Promise<{ readonly jobId: string; readonly created: boolean }> {
  const key = ingestDedupeKey(workspaceId, documentId);

  try {
    await releaseDeadJobDedupeKey(prisma, { workspaceId, dedupeKey: key });

    const result = await queue.enqueue(
      'knowledge.ingest_document',
      { workspaceId, documentId },
      { dedupeKey: key },
    );

    logger.info('knowledge.ingest.queued', {
      workspaceId,
      documentId,
      jobId: result.id,
      created: result.created,
    });

    return { jobId: result.id, created: result.created };
  } catch (error) {
    // The document is saved and nothing will ever pick it up. Marking it failed is what
    // turns an invisible gap into a row the owner can see and a button they can press;
    // `AI_UNAVAILABLE` because a queue that would not accept a write is a dependency that
    // may well accept the next one.
    await markDocumentFailed(prisma, { workspaceId }, documentId, {
      failureCode: 'AI_UNAVAILABLE',
      errorMessage: KNOWLEDGE_FAILURE_MESSAGES.AI_UNAVAILABLE,
    });

    logger.error('knowledge.ingest.failed', {
      workspaceId,
      documentId,
      stage: 'queue',
      failureCode: 'AI_UNAVAILABLE',
      error,
    });

    // Substituted rather than rethrown: whatever the queue said may name a table, a
    // constraint or a connection string, and this one reaches a browser.
    throw new KnowledgeIngestFailure('AI_UNAVAILABLE', { cause: error });
  }
}

/**
 * Records the action, and never fails the request over it.
 *
 * By the time this runs the document is saved. Throwing here would discard completed work
 * and teach the owner that saving is unreliable; a missing audit row is a monitoring
 * problem instead.
 *
 * The metadata is titles, types and counts — never the text. An audit log is read by more
 * people than the workspace it describes, and a return policy pasted into it would leave
 * the same private text in a second table with different retention and no owner.
 */
export async function auditKnowledge(
  ctx: TenantContext,
  action: string,
  documentId: string,
  metadata: Record<string, unknown> | null,
  meta?: AuditMeta,
): Promise<void> {
  try {
    await appendAuditLog(prisma, {
      action,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      resourceType: 'KnowledgeDocument',
      resourceId: documentId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata,
    });
  } catch (error) {
    logger.error('Failed to write knowledge audit log', {
      action,
      documentId,
      workspaceId: ctx.workspaceId,
      error,
    });
  }
}
