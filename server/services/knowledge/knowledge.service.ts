/**
 * Knowledge service.
 *
 * The five things a business owner does to what they have taught their assistant — list,
 * add, edit, delete, try again — and the authorization for all of them. The CRUD itself is
 * unremarkable. These are the parts that would break quietly if nobody wrote them down:
 *
 *   1. **Every function checks permission before it does anything else.** The page also
 *      asks `knowledgeCapability` so it can leave out a control that would be refused, but
 *      that is decoration. A server action can be posted at directly.
 *   2. **A duplicate is caught by the database, not by a read.** `contentHash` carries a
 *      workspace-scoped unique index, and a `ConflictError` here is that index firing. The
 *      "does this already exist?" query it replaces loses to a double-submitted form —
 *      both requests read nothing, both insert, and the workspace ends up holding one
 *      return policy twice, paying for two plan slots and retrieving two copies of the
 *      same evidence.
 *   3. **Processing is queued after the write has committed, never inside it.** The queue
 *      writes through its own client and cannot enrol in a caller's transaction, so a job
 *      enqueued inside a transaction that then rolled back would point at a document that
 *      does not exist.
 *   4. **The plan limit is charged on create only.** Editing or retrying a document the
 *      business already owns does not consume a second slot, and the count behind the
 *      ceiling is every row in every state — a failed document still occupies a row, and a
 *      quota that quietly excused failures would let a workspace hold far more than it
 *      bought by leaving broken ones lying around.
 *   5. **Saving and processing are separate outcomes.** A save that stores the text and
 *      cannot queue the work leaves a visibly failed row with a Retry that works, rather
 *      than a document that claims to be fine and is never read.
 */

import 'server-only';

import { getPlan } from '@/config/plans';
import { isUniqueConstraintViolation, prisma } from '@/db/prisma';
import { BusinessRuleError, ConflictError } from '@/server/errors';
import {
  createKnowledgeDocument as createDocumentRow,
  deleteKnowledgeDocument as deleteDocumentRow,
  ensureKnowledgeBase,
  listKnowledgeDocuments,
  requeueKnowledgeDocument,
  updateKnowledgeDocument as updateDocumentRow,
  type KnowledgeDocumentListRow,
  type KnowledgeDocumentWriteFields,
} from '@/server/repositories/knowledge.repository';
import {
  assertWithinPlanLimit,
  getCurrentLimitUsage,
} from '@/server/services/billing/limit-guard.service';
import {
  knowledgeContentHash,
  type KnowledgeHashSource,
} from '@/server/services/knowledge/content-hash';
import {
  knowledgeCapability,
  type KnowledgeCapability,
} from '@/server/services/knowledge/knowledge.capability';
import {
  assertTouched,
  auditKnowledge,
  intendedEmbeddingModel,
  loadKnowledgeDocument,
  scheduleIngest,
  sourceByteSize,
  type AuditMeta,
} from '@/server/services/knowledge/knowledge.internal';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocumentRef,
  KnowledgeDocumentSource,
  ListKnowledgeDocumentsInput,
  UpdateKnowledgeDocumentInput,
} from '@/server/validation/knowledge';

/** One row of the list, carrying the same capability object every row carries, so a table
 *  cell can decide whether to draw a menu without a second call. */
export type KnowledgeDocumentSummary = KnowledgeDocumentListRow & {
  can: KnowledgeCapability;
};

export type KnowledgeListPage = {
  documents: KnowledgeDocumentSummary[];
  nextCursor: string | null;
  /** Live row count against the plan ceiling, so the page can say "8 of 10" before a save
   *  fails rather than after. `limit` is null on an unmetered plan. */
  usage: { used: number; limit: number | null };
  can: KnowledgeCapability;
};

const DUPLICATE_MESSAGE =
  'You have already saved this. Find it in your knowledge list to edit it, or change the wording to save it as something separate.';

/**
 * The stored shape of a validated payload, derived once.
 *
 * Everything downstream — which columns are written, which fields the fingerprint covers,
 * what the stored size is — comes off the single discriminated value below rather than off
 * three independent `input.type ===` tests. Three tests is three chances for one of them
 * to be written the wrong way round, and the failure that produces is a Q&A stored with
 * its answer in the text column: saved successfully, never retrieved.
 *
 * The text is already normalised. It arrived through the schema, which normalises inside
 * the transform, so the value hashed here is the value stored and the value chunked.
 */
function writeFields(
  input: CreateKnowledgeDocumentInput | UpdateKnowledgeDocumentInput,
): KnowledgeDocumentWriteFields {
  const source: KnowledgeHashSource =
    input.type === 'FAQ'
      ? { type: 'FAQ', title: input.title, question: input.question, answer: input.answer }
      : { type: 'TEXT', title: input.title, content: input.content };

  return {
    title: source.title,
    content: source.type === 'TEXT' ? source.content : null,
    question: source.type === 'FAQ' ? source.question : null,
    answer: source.type === 'FAQ' ? source.answer : null,
    byteSize: sourceByteSize(source),
    contentHash: knowledgeContentHash(source),
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getKnowledgeDocuments(
  ctx: TenantContext,
  input: ListKnowledgeDocumentsInput,
): Promise<KnowledgeListPage> {
  requirePermission(ctx, 'knowledge:read');

  // The usage figure comes from the billing guard rather than a count written here, so the
  // number on the page and the number the ceiling is checked against cannot disagree about
  // what counts. They did disagree once in this codebase's history, and the shape of that
  // bug is a page reading "9 of 10" above a save that refuses.
  const [page, used] = await Promise.all([
    listKnowledgeDocuments(prisma, ctx, {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit,
    }),
    getCurrentLimitUsage(ctx, 'knowledgeDocuments', prisma),
  ]);

  const can = knowledgeCapability(ctx);

  return {
    documents: page.rows.map((row) => ({ ...row, can })),
    nextCursor: page.nextCursor,
    usage: { used, limit: getPlan(ctx.planKey).limits.knowledgeDocuments },
    can,
  };
}

/**
 * Loads one document's source for editing.
 *
 * The null checks are not paranoia about our own writes. `KnowledgeType` in the database
 * holds five more values than V1 supports, and the columns are nullable because a
 * file-backed document would keep its text elsewhere. A row that is neither a complete
 * piece of text nor a complete Q&A cannot be rendered in either dialog, and saying so is
 * better than opening a form with empty fields that would overwrite whatever is there.
 */
export async function getKnowledgeDocumentSource(
  ctx: TenantContext,
  documentId: string,
): Promise<KnowledgeDocumentSource> {
  requirePermission(ctx, 'knowledge:read');

  const row = await loadKnowledgeDocument(ctx, documentId);

  if (row.type === 'TEXT' && row.content !== null) {
    return { documentId: row.id, type: 'TEXT', title: row.title, content: row.content };
  }

  if (row.type === 'FAQ' && row.question !== null && row.answer !== null) {
    return {
      documentId: row.id,
      type: 'FAQ',
      title: row.title,
      question: row.question,
      answer: row.answer,
    };
  }

  throw new BusinessRuleError('This one cannot be edited here. Delete it and add it again.');
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Saves a new document and queues it for processing.
 *
 * The knowledge base row is ensured first and outside any transaction, because it is
 * idempotent and self-healing on a conflict — two documents added at the same moment by
 * two people on the same team both reach it, one creates the row, the other reads it back.
 *
 * Returns the id rather than the row. The page re-reads its list afterwards, so a
 * projection built here would be thrown away; what a caller genuinely needs the id for is
 * to name the document in a log line or to drive its processing in a test.
 */
export async function createKnowledgeDocument(
  ctx: TenantContext,
  input: CreateKnowledgeDocumentInput,
  meta?: AuditMeta,
): Promise<{ readonly documentId: string }> {
  requirePermission(ctx, 'knowledge:create');

  await assertWithinPlanLimit(ctx, 'knowledgeDocuments', 1, prisma);

  const fields = writeFields(input);
  const knowledgeBaseId = await ensureKnowledgeBase(prisma, ctx, intendedEmbeddingModel());

  let documentId: string;
  try {
    const created = await createDocumentRow(prisma, ctx, {
      ...fields,
      knowledgeBaseId,
      type: input.type,
    });
    documentId = created.id;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) throw new ConflictError(DUPLICATE_MESSAGE);
    throw error;
  }

  await auditKnowledge(
    ctx,
    'knowledge.created',
    documentId,
    { type: input.type, title: fields.title, byteSize: fields.byteSize },
    meta,
  );

  await scheduleIngest(ctx.workspaceId, documentId);

  return { documentId };
}

/**
 * Replaces a document's source and processes it again.
 *
 * The type is compared against the stored row and a change is refused. Turning a piece of
 * text into a Q&A would leave `content` populated on a row nothing reads it from, and the
 * document would answer with half of what it used to say.
 *
 * Every edit re-processes, including one that only fixed a typo in the name. The pieces
 * that get embedded are cut from the body alone, so a rename strictly speaking does not
 * need new vectors — but the state machine is "an edited document is pending", and a
 * conditional that sometimes skipped processing is a conditional that will one day skip it
 * for an edit that mattered.
 */
export async function updateKnowledgeDocument(
  ctx: TenantContext,
  input: UpdateKnowledgeDocumentInput,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'knowledge:update');

  const existing = await loadKnowledgeDocument(ctx, input.documentId);

  if (existing.type !== input.type) {
    throw new BusinessRuleError(
      'This cannot be changed from one kind of knowledge into another. Delete it and add it again.',
    );
  }

  const fields = writeFields(input);

  try {
    assertTouched(await updateDocumentRow(prisma, ctx, input.documentId, fields));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) throw new ConflictError(DUPLICATE_MESSAGE);
    throw error;
  }

  await auditKnowledge(
    ctx,
    'knowledge.updated',
    input.documentId,
    {
      type: existing.type,
      title: fields.title,
      byteSize: fields.byteSize,
      sourceChanged: fields.contentHash !== existing.contentHash,
    },
    meta,
  );

  await scheduleIngest(ctx.workspaceId, input.documentId);
}

/**
 * Removes a document and everything derived from it.
 *
 * A hard delete, and the chunks go with it through the foreign key's cascade. Nothing here
 * is soft-deleted the way a product is: a product that vanished from the catalogue can
 * still be referenced by last month's order, whereas a deleted return policy that
 * retrieval could still match is the exact opposite of what pressing Delete meant.
 *
 * A job may already be queued for this document. That is not a problem to solve here — the
 * handler finds no row, records that it skipped, and completes.
 */
export async function deleteKnowledgeDocument(
  ctx: TenantContext,
  input: KnowledgeDocumentRef,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'knowledge:delete');

  // Read before the delete, because the audit row needs to say *what* was removed. An
  // audit trail recording only that a deletion happened cannot answer the question anyone
  // ever asks it.
  const existing = await loadKnowledgeDocument(ctx, input.documentId);

  assertTouched(await deleteDocumentRow(prisma, ctx, input.documentId));

  await auditKnowledge(
    ctx,
    'knowledge.deleted',
    input.documentId,
    { type: existing.type, title: existing.title, chunkCount: existing.chunkCount },
    meta,
  );
}

/**
 * Processes a document again without touching what the business wrote.
 *
 * Deliberately not "edit with the same values". The source is already stored and already
 * normalised, so rewriting it would take a fresh fingerprint over identical text and risk
 * a conflict with the row's own hash.
 *
 * A document that is already working is refused rather than silently re-processed:
 * re-embedding costs the workspace real money and changes nothing, and the button is not
 * offered on those rows. Every other state is accepted, including `PROCESSING` — a worker
 * that died mid-attempt leaves a row that says "Processing" for ever, and being able to
 * push it forward is the entire point of the button.
 */
export async function retryKnowledgeDocument(
  ctx: TenantContext,
  input: KnowledgeDocumentRef,
  meta?: AuditMeta,
): Promise<void> {
  requirePermission(ctx, 'knowledge:update');

  const existing = await loadKnowledgeDocument(ctx, input.documentId);

  if (existing.status === 'READY') {
    throw new BusinessRuleError(
      'This one is already working. Edit it if you want to change what it says.',
    );
  }

  assertTouched(await requeueKnowledgeDocument(prisma, ctx, input.documentId));

  await auditKnowledge(
    ctx,
    'knowledge.retried',
    input.documentId,
    { previousStatus: existing.status, previousFailureCode: existing.failureCode },
    meta,
  );

  await scheduleIngest(ctx.workspaceId, input.documentId);
}
