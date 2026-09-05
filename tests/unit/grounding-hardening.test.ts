/**
 * Unit & Contract Tests for Knowledge Base RAG & Grounding Hardening V1.
 *
 * Covers:
 * - Case A: Relevant knowledge retrieval, prompt injection, grounded answer
 * - Case B: Knowledge does not contain answer (status: NO_EVIDENCE, honest response vs policy hallucination)
 * - Case C: Irrelevant knowledge (below similarity floor, no evidence injected)
 * - Case D: Retrieval failure (status: FAILED, safe degraded prompt, blockedReason: RETRIEVAL_FAILED)
 * - Case E: Multiple chunks (deduplication, character truncation, token budget enforcement)
 * - Case F: Authoritative tool data vs text knowledge (tool precedence, discount validation)
 * - Telemetry: Honest groundingPassed and blockedReason reporting in AgentTurnResult and createAITurn
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/ratelimit/limiter', () => ({
  consume: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: new Date(Date.now() + 60000),
  }),
}));

import {
  applyEvidenceBudget,
  formatEvidence,
  formatGroundingStatus,
  validateGrounding,
  type GroundingConfig,
  type GroundingContext,
  type RetrievedChunk,
} from '@/server/services/agent/grounding.service';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import type { EmbeddingProvider, EmbeddingResult, EmbeddingBatchResult, EmbeddingTask } from '@/services/ai/embedding-provider.interface';
import { ToolRegistry } from '@/server/services/agent/tools/registry';

describe('Grounding Hardening V1 — Evidence Formatting & Budgeting', () => {
  const sampleChunk1: RetrievedChunk = {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    content: 'We deliver nationwide across Pakistan within 3-5 business days.',
    score: 0.92,
  };

  const sampleChunk2: RetrievedChunk = {
    chunkId: 'chunk-2',
    documentId: 'doc-1',
    content: 'Shipping is free for orders over 5000 PKR.',
    score: 0.85,
  };

  it('formats retrieved knowledge evidence with clear demarcation and tool precedence notice', () => {
    const formatted = formatEvidence([sampleChunk1, sampleChunk2]);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('=== RETRIEVED KNOWLEDGE EVIDENCE ===');
    expect(formatted).toContain('Authoritative tool data (live products, inventory, order totals) always takes precedence over text prose.');
    expect(formatted).toContain('--- Evidence 1 ---');
    expect(formatted).toContain(sampleChunk1.content);
    expect(formatted).toContain('--- Evidence 2 ---');
    expect(formatted).toContain(sampleChunk2.content);
    expect(formatted).toContain('=== END EVIDENCE ===');
  });

  it('returns null for empty chunks array', () => {
    expect(formatEvidence([])).toBeNull();
  });

  it('formats explicit status notice for NO_EVIDENCE', () => {
    const statusNotice = formatGroundingStatus('NO_EVIDENCE');
    expect(statusNotice).not.toBeNull();
    expect(statusNotice).toContain('=== KNOWLEDGE BASE SEARCH STATUS ===');
    expect(statusNotice).toContain('NO relevant documentation or policies were found');
    expect(statusNotice).toContain('Do NOT invent, assume, or guess business policies');
  });

  it('formats explicit status notice for FAILED', () => {
    const statusNotice = formatGroundingStatus('FAILED');
    expect(statusNotice).not.toBeNull();
    expect(statusNotice).toContain('Knowledge retrieval is currently unavailable');
    expect(statusNotice).toContain('State politely that you cannot verify this information right now');
  });

  it('returns null status notice for RETRIEVED or SKIPPED', () => {
    expect(formatGroundingStatus('RETRIEVED')).toBeNull();
    expect(formatGroundingStatus('SKIPPED')).toBeNull();
  });

  it('deduplicates identical chunk content to preserve budget diversity (Case E)', () => {
    const config: GroundingConfig = {
      topK: 5,
      similarityFloor: 0.6,
      evidenceTokenBudget: 500,
      maxCharsPerChunk: 500,
    };

    const duplicateChunks: RetrievedChunk[] = [
      { chunkId: 'c1', documentId: 'd1', content: 'Same content here.', score: 0.9 },
      { chunkId: 'c2', documentId: 'd2', content: '  same content here.  ', score: 0.85 },
      { chunkId: 'c3', documentId: 'd3', content: 'Different unique content.', score: 0.8 },
    ];

    const budgeted = applyEvidenceBudget(duplicateChunks, config);
    expect(budgeted.length).toBe(2);
    expect(budgeted.map((c) => c.chunkId)).toEqual(['c1', 'c3']);
  });

  it('truncates oversized chunks with the truncation marker', () => {
    const config: GroundingConfig = {
      topK: 5,
      similarityFloor: 0.6,
      evidenceTokenBudget: 500,
      maxCharsPerChunk: 30,
    };

    const longChunk: RetrievedChunk = {
      chunkId: 'c1',
      documentId: 'd1',
      content: 'This is a very long chunk of text that definitely exceeds thirty characters.',
      score: 0.9,
    };

    const budgeted = applyEvidenceBudget([longChunk], config);
    expect(budgeted.length).toBe(1);
    expect(budgeted[0]?.content).toContain(' […]');
    expect(budgeted[0]?.content.length).toBeLessThanOrEqual(30);
  });

  it('stops including chunks when evidence token budget is reached', () => {
    const config: GroundingConfig = {
      topK: 5,
      similarityFloor: 0.6,
      evidenceTokenBudget: 15, // 15 tokens * 4 chars/token = 60 chars budget
      maxCharsPerChunk: 100,
    };

    const chunks: RetrievedChunk[] = [
      { chunkId: 'c1', documentId: 'd1', content: 'First chunk with 30 characters.', score: 0.9 },
      { chunkId: 'c2', documentId: 'd2', content: 'Second chunk with 35 characters.', score: 0.85 },
      { chunkId: 'c3', documentId: 'd3', content: 'Third chunk that should be excluded.', score: 0.8 },
    ];

    const budgeted = applyEvidenceBudget(chunks, config);
    // 30 chars used. Second is 35 chars -> 30 + 35 = 65 > 60 chars budget.
    // So only first chunk is included!
    expect(budgeted.length).toBe(1);
    expect(budgeted[0]?.chunkId).toBe('c1');
  });
});

describe('Grounding Hardening V1 — Grounding Validation Gate', () => {
  it('passes when response is grounded in retrieved knowledge (Case A)', () => {
    const groundingContext: GroundingContext = {
      chunks: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          content: 'Delivery takes 3 to 5 business days across Pakistan.',
          score: 0.95,
        },
      ],
      formattedEvidence: 'Delivery takes 3 to 5 business days across Pakistan.',
      topScore: 0.95,
      embedded: true,
      embeddingTokens: 8,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'RETRIEVED',
    };

    const result = validateGrounding({
      replyText: 'We deliver across Pakistan within 3 to 5 business days.',
      groundingContext,
      customerMessage: 'How long does delivery take?',
    });

    expect(result.passed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('passes honest uncertainty when no evidence exists (Case B - honest)', () => {
    const groundingContext: GroundingContext = {
      chunks: [],
      formattedEvidence: null,
      topScore: null,
      embedded: true,
      embeddingTokens: 5,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'NO_EVIDENCE',
    };

    const result = validateGrounding({
      replyText: 'I do not have specific details regarding international shipping. Let me connect you with a representative.',
      groundingContext,
      customerMessage: 'Do you ship to the UK?',
    });

    expect(result.passed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('blocks fabricated return/refund policy commitments when no evidence exists (Case B - hallucination)', () => {
    const groundingContext: GroundingContext = {
      chunks: [],
      formattedEvidence: null,
      topScore: null,
      embedded: true,
      embeddingTokens: 5,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'NO_EVIDENCE',
    };

    const result = validateGrounding({
      replyText: 'We offer a 30 days return policy with 100% money back guarantee on all items.',
      groundingContext,
      customerMessage: 'What is your refund policy?',
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.replacementReply).toContain('do not have our official policy details on file');
  });

  it('blocks unauthorized discount promises without tool or knowledge backing (Case F - discount protection)', () => {
    const groundingContext: GroundingContext = {
      chunks: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          content: 'Our spring collection is now in stock.',
          score: 0.88,
        },
      ],
      formattedEvidence: 'Our spring collection is now in stock.',
      topScore: 0.88,
      embedded: true,
      embeddingTokens: 6,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'RETRIEVED',
    };

    const result = validateGrounding({
      replyText: 'Sure! I can give you a 20% discount on your order today.',
      groundingContext,
      customerMessage: 'Can I get a discount?',
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_DISCOUNT_CLAIM');
    expect(result.replacementReply).toContain('cannot confirm any special discounts');
  });

  it('allows discount when authorized in retrieved knowledge (Case A / F)', () => {
    const groundingContext: GroundingContext = {
      chunks: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          content: 'First-time customers receive a 10% discount using code WELCOME10.',
          score: 0.92,
        },
      ],
      formattedEvidence: 'First-time customers receive a 10% discount using code WELCOME10.',
      topScore: 0.92,
      embedded: true,
      embeddingTokens: 10,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'RETRIEVED',
    };

    const result = validateGrounding({
      replyText: 'Yes, as a first-time customer you can get a 10% discount with promo code WELCOME10.',
      groundingContext,
      customerMessage: 'Do you have discounts?',
    });

    expect(result.passed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('allows policy claim when backed by tool output (Case F - tool precedence)', () => {
    const groundingContext: GroundingContext = {
      chunks: [],
      formattedEvidence: null,
      topScore: null,
      embedded: true,
      embeddingTokens: 5,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'NO_EVIDENCE',
    };

    const toolCalls = [
      {
        name: 'get_store_policy',
        result: { policy: '14 days return allowed for unworn apparel.' },
        isError: false,
      },
    ];

    const result = validateGrounding({
      replyText: 'According to our system, we offer a 14 days return window for unworn apparel.',
      groundingContext,
      toolCalls,
      customerMessage: 'Can I return my order?',
    });

    expect(result.passed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('detects retrieval failure and sets RETRIEVAL_FAILED (Case D)', () => {
    const groundingContext: GroundingContext = {
      chunks: [],
      formattedEvidence: null,
      topScore: null,
      embedded: false,
      embeddingTokens: 0,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      status: 'FAILED',
      error: 'Connection timed out',
    };

    const result = validateGrounding({
      replyText: 'We deliver nationwide.',
      groundingContext,
      customerMessage: 'Where do you deliver?',
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('RETRIEVAL_FAILED');
  });
});

describe('Grounding Hardening V1 — Full Agent Turn Integration', () => {
  function createMockDb(overrides: {
    knowledgeBase?: { id: string; workspaceId: string } | null;
    chunks?: RetrievedChunk[];
    handoffKeywords?: string[];
  } = {}) {
    const workspaceId = 'ws-test-123';
    const conversationId = 'conv-test-123';
    const messageId = 'msg-test-123';
    const agentId = 'agent-test-123';

    const recordedTurns: any[] = [];

    const mockDb: any = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: conversationId,
          workspaceId,
          aiEnabled: true,
          status: 'OPEN',
          contact: { id: 'cnt-1', name: 'Zainab' },
          contactId: 'cnt-1',
          unreadCount: 0,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: conversationId,
          workspaceId,
          aiEnabled: true,
          handoffAt: null,
          assignedToMemberId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: messageId,
            workspaceId,
            conversationId,
            direction: 'INBOUND',
            status: 'RECEIVED',
            type: 'TEXT',
            body: 'What is your return policy?',
            createdAt: new Date(),
          },
        ]),
      },
      aIAgent: {
        findFirst: vi.fn().mockResolvedValue({
          id: agentId,
          workspaceId,
          name: 'ConvoNexa AI Assistant',
          isActive: true,
          model: 'gemini-2.5-flash',
          role: 'SUPPORT',
          tone: 'PROFESSIONAL',
          persona: 'Helpful store assistant',
          greeting: 'Hello! How can I help you?',
          handoffKeywords: overrides.handoffKeywords ?? ['agent', 'human', 'representative'],
          instructions: [],
          customInstructions: 'Be concise and accurate.',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: workspaceId,
          currency: 'PKR',
        }),
      },
      knowledgeBase: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.knowledgeBase === undefined
            ? { id: 'kb-1', workspaceId, embeddingModel: 'mock-embedding', embeddingDims: 1536 }
            : overrides.knowledgeBase,
        ),
      },
      notification: {
        create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      aITurn: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const row = { id: `turn-${Date.now()}`, ...data };
          recordedTurns.push(row);
          return row;
        }),
      },
      usageRecord: {
        create: vi.fn().mockResolvedValue({ id: 'usage-1' }),
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      $queryRaw: vi.fn().mockImplementation(async () => {
        return overrides.chunks ?? [];
      }),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return callback(mockDb);
        }
        return callback;
      }),
      _recordedTurns: recordedTurns,
    };

    return { mockDb, workspaceId, conversationId, messageId, agentId };
  }

  class MockDeterministicEmbeddingProvider implements EmbeddingProvider {
    readonly name = 'mock_embed';
    readonly model = 'mock-embedding';
    readonly dimensions = 1536;
    public embedCount = 0;

    async embed(text: string, _task: EmbeddingTask): Promise<EmbeddingResult> {
      this.embedCount++;
      return {
        embedding: new Array(1536).fill(0.01),
        usage: { inputTokens: 5, estimated: true },
      };
    }

    async embedMany(texts: readonly string[], _task: EmbeddingTask): Promise<EmbeddingBatchResult> {
      this.embedCount += texts.length;
      return {
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        usage: { inputTokens: 5 * texts.length, estimated: true },
      };
    }
  }

  it('Case A: executes turn with retrieved knowledge, passing evidence to prompt and recording groundingPassed: true', async () => {
    const chunkContent = 'Our return policy allows returns within 14 days in original packaging.';
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      chunks: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          content: chunkContent,
          distance: 0.09,
        } as any,
      ],
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'You can return items within 14 days in their original packaging.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 25 },
      },
    });

    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.groundingPassed).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(embedProvider.embedCount).toBe(1);

    // Verify evidence reached model prompt
    const sentMessages = provider.callHistory[0]?.messages ?? [];
    const systemMsg = sentMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('=== RETRIEVED KNOWLEDGE EVIDENCE ===');
    expect(systemMsg?.content).toContain(chunkContent);

    // Verify AITurn record
    const turn = mockDb._recordedTurns[0];
    expect(turn).toBeDefined();
    expect(turn.groundingPassed).toBe(true);
    expect(turn.retrievedChunkIds).toEqual(['chunk-1']);
  });

  it('Case B: catches fabricated policy when no evidence exists, replaces reply and triggers handoff', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      chunks: [], // No evidence
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          // Model hallucinates an unsupported policy
          content: 'We offer a 30 days return policy with 100% money back guarantee.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 20 },
      },
    });

    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: new ToolRegistry(),
    });

    // Post-generation validation must catch this
    expect(result.groundingPassed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('AI_ERROR');
    expect(result.replyText).toContain('do not have our official policy details on file');

    // Telemetry must record honest failure
    const turn = mockDb._recordedTurns[0];
    expect(turn.groundingPassed).toBe(false);
    expect(turn.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
  });

  it('Case B: allows honest admission when no evidence exists without triggering blocked claim', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      chunks: [], // No evidence
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          // Model honestly states it cannot confirm policy
          content: 'I do not have our official return policy on file. Let me connect you with our team so they can assist.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 25 },
      },
    });

    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.groundingPassed).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(result.replyText).toContain('I do not have our official return policy on file');
  });

  it('Case D: handles non-retryable retrieval failure gracefully without claiming grounding passed', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb();

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'I cannot look up information right now.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 60, outputTokens: 15 },
      },
    });

    const failingEmbedProvider: EmbeddingProvider = {
      name: 'failing_embed',
      model: 'mock-embedding',
      dimensions: 1536,
      async embed(): Promise<never> {
        // Non-retryable error
        throw new Error('Permanent vector configuration error');
      },
      async embedMany(): Promise<never> {
        throw new Error('Permanent vector configuration error');
      },
    };

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: failingEmbedProvider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.groundingPassed).toBe(false);
    expect(result.blockedReason).toBe('RETRIEVAL_FAILED');
  });

  it('Skips retrieval entirely when customer message matches a handoff keyword', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      handoffKeywords: ['human', 'agent'],
    });

    // Override message body with handoff trigger
    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Please transfer me to a human agent.',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('HANDOFF');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('CUSTOMER_REQUESTED');
    // Retrieval should have been skipped to avoid wasted latency and cost
    expect(embedProvider.embedCount).toBe(0);
  });

  it('Case C: ignores irrelevant chunks below similarity floor, setting status: NO_EVIDENCE and allowing honest reply', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      chunks: [], // Search returned 0 rows because distance exceeded maxDistance
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'We do not sell sports equipment at this time.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 90, outputTokens: 15 },
      },
    });

    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.groundingPassed).toBe(true);
    expect(result.blockedReason).toBeNull();

    // Verify system prompt contained NO_EVIDENCE status notice rather than evidence
    const sentMessages = provider.callHistory[0]?.messages ?? [];
    const systemMsg = sentMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).not.toContain('=== RETRIEVED KNOWLEDGE EVIDENCE ===');
    expect(systemMsg?.content).toContain('=== KNOWLEDGE BASE SEARCH STATUS ===');
    expect(systemMsg?.content).toContain('NO relevant documentation or policies were found');
  });

  it('Case F: tool output takes precedence and satisfies grounding even without knowledge chunks', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      chunks: [], // No knowledge base chunks
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'get_product_price',
      description: 'Get live price for product',
      inputSchema: { parse: (x: any) => x, safeParse: (x: any) => ({ success: true, data: x }) } as any,
      classification: 'READ',
      capabilityRequired: 'products:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => ({
        sku: 'KURTA-BLUE',
        price: 3500,
        currency: 'PKR',
        policy: '7 days return allowed on apparel',
      }),
    });

    const provider = new MockAIProvider();
    // Step 1: Model calls get_product_price
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'get_product_price',
              arguments: { sku: 'KURTA-BLUE' },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 80, outputTokens: 20 },
      },
    });

    // Step 2: Model uses tool result to state price and policy
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'The Blue Kurta is 3,500 PKR, and we offer a 7 days return policy on apparel.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 25 },
      },
    });

    const embedProvider = new MockDeterministicEmbeddingProvider();

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: embedProvider,
      toolRegistry: registry,
      customCapabilities: ['products:read'],
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.groundingPassed).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(result.toolCalls.length).toBe(1);
    expect(result.replyText).toContain('3,500 PKR');
  });

  it('Rejects vector search if embedding dimensions do not match registered model', async () => {
    const { searchKnowledgeChunks } = await import('@/server/repositories/knowledge.repository');
    const { mockDb, workspaceId } = createMockDb();

    // 'mock-embedding' expects 1536 dimensions; passing 512 dimensions should throw InternalError
    const invalidVector = new Array(512).fill(0.01);

    await expect(
      searchKnowledgeChunks(
        mockDb,
        { workspaceId },
        {
          embedding: invalidVector,
          embeddingModel: 'mock-embedding',
          topK: 3,
          similarityFloor: 0.6,
        },
      ),
    ).rejects.toThrow(/Embedding has 512 dimensions but mock-embedding produces 1536/);
  });
});
