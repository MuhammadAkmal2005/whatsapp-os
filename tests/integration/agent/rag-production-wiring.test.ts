/**
 * RAG on the production path.
 *
 * The subject here is not retrieval quality — `knowledge-retrieval.test.ts` owns
 * that — but whether the `ai.respond` job handler that actually runs in production
 * reaches it. Before this task it did not: the runtime treats `embeddingProvider`
 * as optional, the handler omitted it, and so RAG worked in every test that passed
 * a provider explicitly and did not exist for a single real customer. That is a
 * failure no unit test can see, which is why these drive the real handler rather
 * than `executeAgentTurn` directly.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { APPROX_CHARS_PER_TOKEN, KNOWLEDGE_RETRIEVAL } from '@/config/constants';
import { estimateEmbeddingCostMicros } from '@/config/models';
import { prisma } from '@/db/prisma';
import { aiRespondHandler } from '@/server/jobs/handlers/ai-turn.handler';
import type { JobContext } from '@/server/jobs/registry';
import { insertKnowledgeChunks } from '@/server/repositories/knowledge.repository';
import {
  getMockEmbeddingProvider,
  resetMockEmbeddingProvider,
} from '@/server/services/agent/embedding-provider.factory';
import { retrieveGroundingContext } from '@/server/services/agent/grounding.service';
import { getMockAIProvider, resetMockAIProvider } from '@/server/services/agent/provider.factory';

import {
  createAgentFixture,
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

/** What the worker passes a handler. Constructed here because the point is to drive
 *  the real handler, not a wrapper around it. */
const jobContext: JobContext = {
  jobId: 'test-job',
  attempt: 1,
  maxAttempts: 3,
  signal: new AbortController().signal,
};

/** The generation model, set explicitly so metering rows can be told apart from the
 *  embedding row by model as well as by metric. */
const GENERATION_MODEL = 'gemini-2.5-flash';

/**
 * The customer's own words, used both as the message and as the retrieval key for
 * the chunk that answers it.
 *
 * The mock embedding provider projects text deterministically and ignores the task,
 * so seeding a chunk with the vector of this phrase makes its similarity exactly 1 —
 * the floor, rather than the mock's geometry, then decides whether evidence is
 * admitted. Embedding an FAQ's question and storing its answer as the chunk body is
 * a real ingestion pattern, not a contrivance.
 *
 * Written in lower case on purpose: the runtime folds the message to lower case
 * before retrieval (the same string feeds handoff-keyword matching), and a test that
 * quietly depended on that fold would be asserting the wrong thing.
 */
const CUSTOMER_QUESTION = 'what is your refund policy';
const REFUND_ANSWER =
  'Refund policy: unworn items can be returned within 30 days of delivery. Refunds are issued to the original payment method, or as cash for COD orders.';

async function seedConversation(workspaceId: string, body = CUSTOMER_QUESTION) {
  const contact = await createContactFixture(workspaceId);
  const conversation = await prisma.conversation.create({
    data: { workspaceId, contactId: contact.id, status: 'OPEN', aiEnabled: true },
  });
  const message = await prisma.message.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      status: 'RECEIVED',
      type: 'TEXT',
      body,
      occurredAt: new Date(),
    },
  });

  return { conversationId: conversation.id, messageId: message.id };
}

async function createKnowledgeDocument(workspaceId: string, title: string) {
  const knowledgeBase = await prisma.knowledgeBase.create({
    data: { workspaceId, embeddingModel: 'mock-embedding', embeddingDims: 1536 },
  });

  return prisma.knowledgeDocument.create({
    data: {
      workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      type: 'TEXT',
      title,
      status: 'READY',
    },
  });
}

/**
 * Seeds chunks whose vectors come from `embedFrom` rather than from their own text,
 * so a test can state exactly what a chunk is retrievable by.
 */
async function seedKnowledge(
  workspaceId: string,
  entries: ReadonlyArray<{ content: string; embedFrom: string }>,
) {
  const document = await createKnowledgeDocument(workspaceId, 'Store policies');

  const provider = getMockEmbeddingProvider();
  const { embeddings } = await provider.embedMany(
    entries.map((entry) => entry.embedFrom),
    'document',
  );

  await insertKnowledgeChunks(
    prisma,
    { workspaceId },
    entries.map((entry, index) => ({
      documentId: document.id,
      position: index,
      content: entry.content,
      embedding: embeddings[index] as number[],
    })),
    { embeddingModel: provider.model, embeddedAt: new Date('2026-09-05T09:00:00.000Z') },
  );

  // Seeding used the provider too; clear so assertions see only the turn's own calls.
  resetMockEmbeddingProvider();
}

function systemPromptFromLastCall(): string {
  const request = getMockAIProvider().callHistory.at(-1);
  return request?.messages.find((message) => message.role === 'system')?.content ?? '';
}

function enqueueReply(content: string): void {
  getMockAIProvider().enqueue({
    type: 'response',
    response: { message: { role: 'assistant', content }, finishReason: 'stop' },
  });
}

describe('ai.respond handler — production RAG wiring', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockAIProvider();
    resetMockEmbeddingProvider();
  });

  it('embeds the customer question through the configured provider', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createAgentFixture(workspaceId, { model: GENERATION_MODEL });
    await seedKnowledge(workspaceId, [{ content: REFUND_ANSWER, embedFrom: CUSTOMER_QUESTION }]);
    const { conversationId, messageId } = await seedConversation(workspaceId);

    enqueueReply('Refunds are accepted within 30 days.');

    await aiRespondHandler({ workspaceId, conversationId, messageId }, jobContext);

    // A provider reached the grounding service at all — which is the whole fix — and
    // the query task, not the document task, was used. An asymmetric model ranks
    // worse for the wrong task with no visible symptom.
    expect(getMockEmbeddingProvider().callHistory).toEqual([
      { text: CUSTOMER_QUESTION, task: 'query' },
    ]);
  });

  it('puts retrieved evidence in the prompt when the workspace has knowledge', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createAgentFixture(workspaceId, { model: GENERATION_MODEL });
    await seedKnowledge(workspaceId, [{ content: REFUND_ANSWER, embedFrom: CUSTOMER_QUESTION }]);
    const { conversationId, messageId } = await seedConversation(workspaceId);

    enqueueReply('Unworn items can be returned within 30 days.');

    await aiRespondHandler({ workspaceId, conversationId, messageId }, jobContext);

    const systemPrompt = systemPromptFromLastCall();
    expect(systemPrompt).toContain('=== RETRIEVED KNOWLEDGE EVIDENCE ===');
    expect(systemPrompt).toContain(REFUND_ANSWER);

    const turn = await prisma.aITurn.findFirst({ where: { workspaceId, messageId } });
    expect(turn?.retrievedChunkIds).toHaveLength(1);
    expect(turn?.retrievalTopScore ?? 0).toBeGreaterThan(KNOWLEDGE_RETRIEVAL.similarityFloor);
  });

  // A workspace that has not taught the AI anything must still get an answer, and
  // must not get an evidence block claiming knowledge that does not exist.
  it('answers safely when the workspace has no knowledge base', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createAgentFixture(workspaceId, { model: GENERATION_MODEL });
    const { conversationId, messageId } = await seedConversation(workspaceId);

    enqueueReply('Let me connect you with our team.');

    await aiRespondHandler({ workspaceId, conversationId, messageId }, jobContext);

    expect(systemPromptFromLastCall()).not.toContain('=== RETRIEVED KNOWLEDGE EVIDENCE ===');
    // The knowledge base row is the gate, so there is no corpus to search and no
    // embedding to pay for.
    expect(getMockEmbeddingProvider().callHistory).toEqual([]);
    expect(
      await prisma.usageRecord.count({ where: { workspaceId, metric: 'AI_EMBEDDING_TOKENS' } }),
    ).toBe(0);

    // `AITurn` has no status column — a turn that worked is one that recorded a reply
    // and no error, which is also what the customer actually experiences. Asserting
    // the exact text also proves the reply was neither blocked nor rewritten.
    const turn = await prisma.aITurn.findFirst({ where: { workspaceId, messageId } });
    expect(turn?.outputText).toBe('Let me connect you with our team.');
    expect(turn?.errorMessage).toBeNull();
    expect(turn?.retrievedChunkIds).toEqual([]);
    expect(turn?.retrievalTopScore).toBeNull();
  });

  it('cannot retrieve another workspace\'s knowledge through the handler', async () => {
    const mine = await createWorkspaceFixture({ name: 'Akmal Fashion' });
    const theirs = await createWorkspaceFixture({ name: 'Rival Threads' });

    await createAgentFixture(mine.workspaceId, { model: GENERATION_MODEL });
    // Mine has a knowledge base, so retrieval definitely runs — but the only chunk
    // that answers the question lives in the other tenant.
    await seedKnowledge(mine.workspaceId, [
      { content: 'Delivery in Lahore takes 2 to 3 working days.', embedFrom: 'delivery time' },
    ]);
    await seedKnowledge(theirs.workspaceId, [
      {
        content: 'RIVAL SECRET: refunds are unlimited and never questioned.',
        embedFrom: CUSTOMER_QUESTION,
      },
    ]);

    const { conversationId, messageId } = await seedConversation(mine.workspaceId);

    enqueueReply('I will check with the team on refunds.');

    await aiRespondHandler(
      { workspaceId: mine.workspaceId, conversationId, messageId },
      jobContext,
    );

    const systemPrompt = systemPromptFromLastCall();
    expect(systemPrompt).not.toContain('RIVAL SECRET');
    expect(systemPrompt).not.toContain('unlimited');

    const turn = await prisma.aITurn.findFirst({
      where: { workspaceId: mine.workspaceId, messageId },
    });
    expect(turn?.retrievedChunkIds).toEqual([]);
  });
});

describe('embedding usage metering', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockAIProvider();
    resetMockEmbeddingProvider();
  });

  it('records one AI_EMBEDDING_TOKENS row per grounded turn, separate from generation', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createAgentFixture(workspaceId, { model: GENERATION_MODEL });
    await seedKnowledge(workspaceId, [{ content: REFUND_ANSWER, embedFrom: CUSTOMER_QUESTION }]);
    const { conversationId, messageId } = await seedConversation(workspaceId);

    enqueueReply('Within 30 days, unworn.');

    await aiRespondHandler({ workspaceId, conversationId, messageId }, jobContext);

    const records = await prisma.usageRecord.findMany({
      where: { workspaceId },
      select: { metric: true, quantity: true, provider: true, model: true, costMicros: true },
    });

    const embedding = records.filter((row) => row.metric === 'AI_EMBEDDING_TOKENS');
    expect(embedding).toHaveLength(1);
    expect(embedding[0]?.model).toBe('mock-embedding');
    // Locally estimated from characters, because the Developer API reports no usable
    // per-input token count for embeddings.
    expect(embedding[0]?.quantity).toBe(
      Math.ceil(CUSTOMER_QUESTION.length / APPROX_CHARS_PER_TOKEN),
    );

    // Generation stays on its own metrics, at the generation model's price. Summing
    // embedding tokens into AI_INPUT_TOKENS would price retrieval as generation.
    const generation = records.filter((row) => row.metric !== 'AI_EMBEDDING_TOKENS');
    expect(generation.map((row) => row.metric).sort()).toEqual([
      'AI_INPUT_TOKENS',
      'AI_OUTPUT_TOKENS',
      'AI_REQUEST',
    ]);
    expect(generation.every((row) => row.model === GENERATION_MODEL)).toBe(true);
  });

  // A tiny query still costs money and still has to appear in analytics, so the row
  // is written because a call happened — not because the estimate came out large.
  it('records a row even when the token estimate rounds to a single token', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createAgentFixture(workspaceId, { model: GENERATION_MODEL });
    await seedKnowledge(workspaceId, [{ content: REFUND_ANSWER, embedFrom: CUSTOMER_QUESTION }]);
    const { conversationId, messageId } = await seedConversation(workspaceId, 'hi');

    enqueueReply('Assalam-o-alaikum! How can I help?');

    await aiRespondHandler({ workspaceId, conversationId, messageId }, jobContext);

    const embedding = await prisma.usageRecord.findMany({
      where: { workspaceId, metric: 'AI_EMBEDDING_TOKENS' },
    });

    expect(embedding).toHaveLength(1);
    expect(embedding[0]?.quantity).toBe(1);
  });

  // The mock is free, so its zero is honest. Gemini's is not, and the number has to
  // come from the catalogue rather than a hardcoded 0.
  it('prices a Gemini embedding from the model catalogue', () => {
    expect(estimateEmbeddingCostMicros('gemini-embedding-001', 1_000_000)).toBe(150_000);
    expect(estimateEmbeddingCostMicros('gemini-embedding-001', 0)).toBe(0);
    expect(estimateEmbeddingCostMicros('mock-embedding', 1_000_000)).toBe(0);
    // An unrecognised model fails honestly rather than borrowing another provider's
    // price.
    expect(estimateEmbeddingCostMicros('text-embedding-does-not-exist', 1000)).toBeNull();
  });
});

describe('evidence budget', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockEmbeddingProvider();
  });

  /**
   * Re-normalises a vector nudged off the query direction.
   *
   * Chunks seeded with identical vectors would all sit at similarity 1 and leave the
   * ordering to Postgres' tie-breaking, so a determinism assertion over them would be
   * testing the heap rather than the budget. A small nudge on one axis gives a strict
   * total order that is still far above the similarity floor.
   */
  function nudgedFrom(query: readonly number[], epsilon: number): number[] {
    const nudged = query.map((value, index) => (index === 0 ? value + epsilon : value));
    const length = Math.sqrt(nudged.reduce((total, value) => total + value * value, 0));
    return nudged.map((value) => value / length);
  }

  /** `count` chunks of `charsEach` characters, at strictly decreasing similarity to
   *  `CUSTOMER_QUESTION`, so only the budget can cut them. */
  async function seedLongChunks(workspaceId: string, count: number, charsEach: number) {
    const document = await createKnowledgeDocument(workspaceId, 'Long policy document');

    const provider = getMockEmbeddingProvider();
    const { embedding: queryVector } = await provider.embed(CUSTOMER_QUESTION, 'document');

    await insertKnowledgeChunks(
      prisma,
      { workspaceId },
      Array.from({ length: count }, (_, index) => ({
        documentId: document.id,
        position: index,
        content: `Section ${index}: ${'policy detail '.repeat(Math.ceil(charsEach / 14))}`.slice(
          0,
          charsEach,
        ),
        embedding: nudgedFrom(queryVector, 0.05 * (index + 1)),
      })),
      { embeddingModel: provider.model, embeddedAt: new Date('2026-09-05T09:00:00.000Z') },
    );

    resetMockEmbeddingProvider();
  }

  it('truncates a chunk that exceeds the per-chunk ceiling', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await seedLongChunks(workspaceId, 1, KNOWLEDGE_RETRIEVAL.maxCharsPerChunk * 3);

    const context = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      CUSTOMER_QUESTION,
      getMockEmbeddingProvider(),
    );

    expect(context.chunks).toHaveLength(1);
    expect(context.chunks[0]?.content).toHaveLength(KNOWLEDGE_RETRIEVAL.maxCharsPerChunk);
    expect(context.chunks[0]?.content.endsWith(' […]')).toBe(true);
    // What the model saw is what the turn records, so telemetry is not a lie.
    expect(context.formattedEvidence).toContain(context.chunks[0]?.content as string);
  });

  it('stops admitting chunks once the token budget is spent', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    // Six chunks at the per-chunk ceiling exceed a 1,200-token (4,800-character)
    // budget, and all six clear the floor, so the budget is the only thing that can
    // drop one.
    await seedLongChunks(workspaceId, 6, KNOWLEDGE_RETRIEVAL.maxCharsPerChunk);

    const context = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      CUSTOMER_QUESTION,
      getMockEmbeddingProvider(),
    );

    const budgetChars = KNOWLEDGE_RETRIEVAL.evidenceTokenBudget * APPROX_CHARS_PER_TOKEN;
    const usedChars = context.chunks.reduce((total, chunk) => total + chunk.content.length, 0);

    expect(context.chunks.length).toBeLessThan(6);
    expect(usedChars).toBeLessThanOrEqual(budgetChars);
  });

  it('is deterministic: the same corpus and query give the same evidence twice', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await seedLongChunks(workspaceId, 6, KNOWLEDGE_RETRIEVAL.maxCharsPerChunk);

    const first = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      CUSTOMER_QUESTION,
      getMockEmbeddingProvider(),
    );
    const second = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      CUSTOMER_QUESTION,
      getMockEmbeddingProvider(),
    );

    expect(second.formattedEvidence).toBe(first.formattedEvidence);
    expect(second.chunks.map((chunk) => chunk.chunkId)).toEqual(
      first.chunks.map((chunk) => chunk.chunkId),
    );
  });

  // Dropping the best chunk because it alone exceeds the budget would turn a
  // successful retrieval into a silent "I don't know".
  it('always keeps the highest-scoring chunk, truncated if it alone is too long', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await seedLongChunks(workspaceId, 1, KNOWLEDGE_RETRIEVAL.maxCharsPerChunk * 5);

    const context = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      CUSTOMER_QUESTION,
      getMockEmbeddingProvider(),
      { ...KNOWLEDGE_RETRIEVAL, evidenceTokenBudget: 1 },
    );

    expect(context.chunks).toHaveLength(1);
    expect(context.formattedEvidence).not.toBeNull();
    expect(context.topScore).not.toBeNull();
  });

  it('reports honest empty evidence when nothing clears the floor', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await seedLongChunks(workspaceId, 2, 200);

    const context = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      'completely unrelated enquiry about wholesale fabric sourcing',
      getMockEmbeddingProvider(),
    );

    expect(context.chunks).toEqual([]);
    expect(context.formattedEvidence).toBeNull();
    expect(context.topScore).toBeNull();
    // The embedding still happened, so it is still metered.
    expect(context.embedded).toBe(true);
    expect(context.embeddingTokens).toBeGreaterThan(0);
    expect(context.embeddingProvider).toBe('mock');
    expect(context.embeddingModel).toBe('mock-embedding');
  });

  it('does not embed a message too short to carry intent', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await seedLongChunks(workspaceId, 1, 200);

    const context = await retrieveGroundingContext(
      prisma,
      { workspaceId },
      ' ?',
      getMockEmbeddingProvider(),
    );

    expect(context.embedded).toBe(false);
    expect(context.embeddingTokens).toBe(0);
    expect(getMockEmbeddingProvider().callHistory).toEqual([]);
  });
});
