/**
 * Background Job Handler: Knowledge Document Ingestion.
 *
 * Deliberately almost empty. The queue's contract — a handler is idempotent, throws to signal
 * "try again", and returns to signal "done" — is satisfied entirely by the ingest service, and
 * the two are kept apart so that the service can be driven straight from a test without a job
 * row, and so that no ingestion rule ends up living in a file the worker owns.
 *
 * The payload carries `workspaceId`, and this is the one place in the feature where that is not
 * a tenancy hole: the queue is cross-tenant by construction, so a job's scope has to travel
 * inside it. It was written there by a service that had already checked permission, and the
 * service below re-enters tenant-scoped territory immediately — every read and write it makes
 * is filtered by it.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { ingestKnowledgeDocument } from '@/server/services/knowledge/knowledge-ingest.service';
import type { JobHandler } from '../registry';

export const knowledgeIngestDocumentHandler: JobHandler<'knowledge.ingest_document'> = async (
  payload,
  context,
) => {
  const outcome = await ingestKnowledgeDocument({
    workspaceId: payload.workspaceId,
    documentId: payload.documentId,
    jobId: context.jobId,
    attempt: context.attempt,
    maxAttempts: context.maxAttempts,
    signal: context.signal,
  });

  logger.info('knowledge.ingest.job_finished', {
    jobId: context.jobId,
    workspaceId: payload.workspaceId,
    documentId: payload.documentId,
    attempt: context.attempt,
    outcome,
  });
};
