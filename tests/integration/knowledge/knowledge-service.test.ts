/**
 * The knowledge service against a real database.
 *
 * What is worth asserting here is not that Prisma can write a row. It is the four rules that
 * would fail silently and expensively: that a role without the permission is refused
 * server-side, that another tenant's document reads as absent rather than as forbidden, that
 * the duplicate constraint is the database's and not a racy read, and that the plan ceiling
 * counts every row a workspace holds rather than only the working ones.
 */

import { describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from '@/server/errors';
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocumentSource,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/server/services/knowledge/knowledge.service';
import { changeSubscriptionPlan, ensureWorkspaceSubscription } from '@/server/services/subscription/subscription.service';
import type { TenantContext } from '@/server/tenancy/context';
import {
  createKnowledgeDocumentSchema,
  updateKnowledgeDocumentSchema,
} from '@/server/validation/knowledge';

import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

const DELIVERY = {
  type: 'TEXT' as const,
  title: 'Delivery information',
  content:
    'Delivery is Rs. 250 anywhere in Pakistan. Lahore and Karachi take 2-3 days, other cities 3-5 days.',
};

const COD = {
  type: 'FAQ' as const,
  title: 'Cash on delivery',
  question: 'Do you offer cash on delivery?',
  answer: 'Jee bilkul. COD is available nationwide with no extra charge.',
};

function createInput(overrides: Partial<typeof DELIVERY> = {}) {
  return createKnowledgeDocumentSchema.parse({ ...DELIVERY, ...overrides });
}

/** A member of the same workspace whose role holds `knowledge:read` and nothing more. */
async function viewerContextFor(ws: WorkspaceFixture): Promise<TenantContext> {
  const viewer = await createMemberFixture(ws.workspaceId, 'VIEWER', { name: 'Bilal Ahmed' });

  return tenantContextFor({
    workspaceId: ws.workspaceId,
    workspaceSlug: ws.workspaceSlug,
    workspaceName: 'Akmal Fashion',
    currency: 'PKR',
    userId: viewer.userId,
    userName: viewer.name,
    userEmail: viewer.email,
    membershipId: viewer.membershipId,
    role: 'VIEWER',
  });
}

describe('knowledge service — reads and writes', () => {
  it('saves a document as pending and queues exactly one job for it', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.workspaceId).toBe(ws.workspaceId);
    expect(row.status).toBe('PENDING');
    expect(row.type).toBe('TEXT');
    expect(row.content).toBe(DELIVERY.content);
    expect(row.question).toBeNull();
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.byteSize).toBe(Buffer.byteLength(DELIVERY.content, 'utf8'));
    expect(row.chunkCount).toBe(0);

    const jobs = await prisma.job.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe('knowledge.ingest_document');
    expect(jobs[0]?.payload).toEqual({ workspaceId: ws.workspaceId, documentId });
    expect(jobs[0]?.dedupeKey).toBe(
      `knowledge.ingest_document:${ws.workspaceId}:${documentId}`,
    );

    // The knowledge base row is created on first save, so nothing else has to remember to.
    const base = await prisma.knowledgeBase.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId },
    });
    expect(row.knowledgeBaseId).toBe(base.id);

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, action: 'knowledge.created' },
    });
    expect(audit?.resourceType).toBe('KnowledgeDocument');
    expect(audit?.resourceId).toBe(documentId);
  });

  it('stores a Q&A in its own columns', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(
      ws.context,
      createKnowledgeDocumentSchema.parse(COD),
    );

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.type).toBe('FAQ');
    expect(row.content).toBeNull();
    expect(row.question).toBe(COD.question);
    expect(row.answer).toBe(COD.answer);

    const source = await getKnowledgeDocumentSource(ws.context, documentId);
    expect(source).toEqual({
      documentId,
      type: 'FAQ',
      title: COD.title,
      question: COD.question,
      answer: COD.answer,
    });
  });

  // The list feeds a table. Sending the full body of every document to build a table is a
  // page that gets slower every time the business teaches the assistant something.
  it('lists documents without their source bodies', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    await createKnowledgeDocument(ws.context, createInput());
    await createKnowledgeDocument(ws.context, createKnowledgeDocumentSchema.parse(COD));

    const page = await getKnowledgeDocuments(ws.context, { limit: 20 });

    expect(page.documents).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    expect(page.usage).toEqual({ used: 2, limit: 150 });

    for (const document of page.documents) {
      expect(document).not.toHaveProperty('content');
      expect(document).not.toHaveProperty('question');
      expect(document).not.toHaveProperty('answer');
      expect(document.can.update).toBe(true);
    }
  });

  it('replaces the source, resets the row to pending and queues it again', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());

    // Pretend the first attempt failed, so the reset is observable.
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        errorMessage: 'We could not finish this just now. Try again in a few minutes.',
        failureCode: 'AI_UNAVAILABLE',
        startedAt: new Date(),
      },
    });
    await prisma.job.deleteMany({ where: { workspaceId: ws.workspaceId } });

    await updateKnowledgeDocument(
      ws.context,
      updateKnowledgeDocumentSchema.parse({
        documentId,
        type: 'TEXT',
        title: 'Delivery information',
        content: 'Delivery is Rs. 300 anywhere in Pakistan. Free above Rs. 5,000.',
      }),
    );

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('PENDING');
    expect(row.content).toBe('Delivery is Rs. 300 anywhere in Pakistan. Free above Rs. 5,000.');
    expect(row.errorMessage).toBeNull();
    expect(row.failureCode).toBeNull();
    expect(row.startedAt).toBeNull();

    const jobs = await prisma.job.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(jobs).toHaveLength(1);
  });

  it('refuses to turn one kind of knowledge into another', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());

    await expect(
      updateKnowledgeDocument(
        ws.context,
        updateKnowledgeDocumentSchema.parse({ documentId, ...COD }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.type).toBe('TEXT');
    expect(row.content).toBe(DELIVERY.content);
  });

  it('re-queues a failed document without rewriting what the business typed', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());
    const created = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'FAILED', failureCode: 'AI_UNAVAILABLE', errorMessage: 'Try again later.' },
    });
    await prisma.job.deleteMany({ where: { workspaceId: ws.workspaceId } });

    await retryKnowledgeDocument(ws.context, { documentId });

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('PENDING');
    expect(row.failureCode).toBeNull();
    expect(row.errorMessage).toBeNull();
    // The fingerprint is untouched, so retrying cannot conflict with the row's own hash.
    expect(row.contentHash).toBe(created.contentHash);
    expect(await prisma.job.count({ where: { workspaceId: ws.workspaceId } })).toBe(1);
  });

  it('refuses to re-process a document that is already working', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'READY', chunkCount: 1, ingestedAt: new Date() },
    });

    await expect(retryKnowledgeDocument(ws.context, { documentId })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  // A worker that died mid-attempt leaves a row saying "Processing" for ever. Being able to
  // push that row forward is the whole reason the button exists.
  it('re-queues a document stuck in processing', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    await retryKnowledgeDocument(ws.context, { documentId });

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('PENDING');
    expect(row.startedAt).toBeNull();
  });

  it('deletes the document and everything derived from it', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());
    await prisma.knowledgeChunk.create({
      data: {
        workspaceId: ws.workspaceId,
        documentId,
        position: 0,
        content: 'Delivery is Rs. 250 anywhere in Pakistan.',
        embeddingModel: 'mock-embedding',
        embeddingDims: 1536,
        embeddedAt: new Date(),
      },
    });

    await deleteKnowledgeDocument(ws.context, { documentId });

    expect(await prisma.knowledgeDocument.count({ where: { id: documentId } })).toBe(0);
    expect(await prisma.knowledgeChunk.count({ where: { documentId } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, action: 'knowledge.deleted' },
    });
    expect(audit?.resourceId).toBe(documentId);
  });
});

describe('knowledge service — duplicates', () => {
  it('refuses a second copy of the same source with a conflict', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    await createKnowledgeDocument(ws.context, createInput());

    await expect(createKnowledgeDocument(ws.context, createInput())).rejects.toBeInstanceOf(
      ConflictError,
    );

    // No half-saved second row, and therefore no second plan slot consumed.
    expect(await prisma.knowledgeDocument.count({ where: { workspaceId: ws.workspaceId } })).toBe(
      1,
    );
  });

  // The constraint is the database's, so two simultaneous submissions cannot both read
  // "nothing there yet" and both insert. A service-layer read would let exactly that through.
  //
  // The subscription row is created up front deliberately. Both saves would otherwise also
  // race to bootstrap it on their way through the plan guard, and that unrelated collision
  // would be the first thing either request hit — leaving this test passing or failing on
  // something other than the duplicate constraint it is about.
  it('holds under two concurrent saves of the same source', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();
    await ensureWorkspaceSubscription(prisma, ws.workspaceId);

    const results = await Promise.allSettled([
      createKnowledgeDocument(ws.context, createInput()),
      createKnowledgeDocument(ws.context, createInput()),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' && rejected.reason).toBeInstanceOf(
      ConflictError,
    );
    expect(await prisma.knowledgeDocument.count({ where: { workspaceId: ws.workspaceId } })).toBe(
      1,
    );
  });

  it('lets a different workspace save identical wording', async () => {
    await resetDatabase();
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });

    await createKnowledgeDocument(mine.context, createInput());
    await createKnowledgeDocument(theirs.context, createInput());

    expect(await prisma.knowledgeDocument.count()).toBe(2);
  });

  it('refuses an edit that would duplicate another document', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();

    await createKnowledgeDocument(ws.context, createInput());
    const second = await createKnowledgeDocument(
      ws.context,
      createInput({ title: 'Returns', content: 'Exchange within 7 days with the receipt.' }),
    );

    await expect(
      updateKnowledgeDocument(
        ws.context,
        updateKnowledgeDocumentSchema.parse({ documentId: second.documentId, ...DELIVERY }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('knowledge service — authorization', () => {
  it('lets a read-only member look but not touch', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture();
    const viewer = await viewerContextFor(ws);

    const { documentId } = await createKnowledgeDocument(ws.context, createInput());

    const page = await getKnowledgeDocuments(viewer, { limit: 20 });
    expect(page.documents).toHaveLength(1);
    expect(page.can.create).toBe(false);
    expect(page.can.update).toBe(false);
    expect(page.can.delete).toBe(false);
    expect(page.can.retry).toBe(false);

    await expect(createKnowledgeDocument(viewer, createInput({ title: 'Returns' })))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateKnowledgeDocument(
        viewer,
        updateKnowledgeDocumentSchema.parse({ documentId, ...DELIVERY }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retryKnowledgeDocument(viewer, { documentId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(deleteKnowledgeDocument(viewer, { documentId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Refused before anything was written, not after.
    expect(await prisma.knowledgeDocument.count({ where: { workspaceId: ws.workspaceId } })).toBe(
      1,
    );
  });

  // `NotFoundError`, never `ForbiddenError`. Forbidden confirms the id exists somewhere and
  // turns the id space into an enumeration oracle.
  it('reports another workspace\'s document as absent', async () => {
    await resetDatabase();
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });

    const { documentId } = await createKnowledgeDocument(mine.context, createInput());

    await expect(getKnowledgeDocumentSource(theirs.context, documentId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateKnowledgeDocument(
        theirs.context,
        updateKnowledgeDocumentSchema.parse({ documentId, ...DELIVERY, title: 'Hijacked' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(retryKnowledgeDocument(theirs.context, { documentId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteKnowledgeDocument(theirs.context, { documentId })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.title).toBe(DELIVERY.title);
    expect(row.workspaceId).toBe(mine.workspaceId);
  });

  it('never lists another workspace\'s documents', async () => {
    await resetDatabase();
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Other Shop' });

    await createKnowledgeDocument(mine.context, createInput());
    await createKnowledgeDocument(
      theirs.context,
      createInput({ title: 'Their delivery', content: 'Their charges are Rs. 350.' }),
    );

    const page = await getKnowledgeDocuments(mine.context, { limit: 20 });
    expect(page.documents.map((document) => document.title)).toEqual([DELIVERY.title]);
    expect(page.usage.used).toBe(1);
  });
});

describe('knowledge service — plan limit', () => {
  it('charges a slot per document and counts every state', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Quota Shop' });
    // Free allows five documents.
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    for (let index = 0; index < 5; index += 1) {
      await createKnowledgeDocument(
        ws.context,
        createInput({ title: `Policy ${index}`, content: `Policy number ${index} text.` }),
      );
    }

    // A failed document still occupies a row. Excusing failures from the ceiling would let a
    // workspace hold far more than it bought by leaving broken ones lying around.
    await prisma.knowledgeDocument.updateMany({
      where: { workspaceId: ws.workspaceId },
      data: { status: 'FAILED', failureCode: 'AI_FAILED' },
    });

    await expect(
      createKnowledgeDocument(
        ws.context,
        createInput({ title: 'Policy 5', content: 'One too many.' }),
      ),
    ).rejects.toBeInstanceOf(LimitExceededError);

    expect(await prisma.knowledgeDocument.count({ where: { workspaceId: ws.workspaceId } })).toBe(
      5,
    );
  });

  it('does not charge a slot for an edit or a retry, and releases one on delete', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Quota Shop' });
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await createKnowledgeDocument(
        ws.context,
        createInput({ title: `Policy ${index}`, content: `Policy number ${index} text.` }),
      );
      ids.push(created.documentId);
    }

    const [first] = ids;
    if (first === undefined) throw new Error('fixture did not create any documents');

    // At the ceiling, both of these must still work.
    await updateKnowledgeDocument(
      ws.context,
      updateKnowledgeDocumentSchema.parse({
        documentId: first,
        type: 'TEXT',
        title: 'Policy 0',
        content: 'Policy number 0, corrected.',
      }),
    );
    await retryKnowledgeDocument(ws.context, { documentId: first });

    await deleteKnowledgeDocument(ws.context, { documentId: first });

    const after = await createKnowledgeDocument(
      ws.context,
      createInput({ title: 'Policy 5', content: 'Fits in the freed slot.' }),
    );
    expect(after.documentId).toBeTruthy();
    expect(await prisma.knowledgeDocument.count({ where: { workspaceId: ws.workspaceId } })).toBe(
      5,
    );
  });
});
