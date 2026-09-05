import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server/ratelimit/limiter', () => ({
  consume: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: new Date(Date.now() + 60000),
  }),
}));

import { z } from 'zod';
import {
  isProhibitedMemoryKey,
  createCustomerMemorySchema,
} from '@/server/validation/customer-memory';
import {
  extractDurableFactsFromMessage,
  selectRelevantMemories,
  formatCustomerMemoryPrompt,
  loadCustomerMemoryContext,
  recordCustomerMemory,
  deleteCustomerMemory,
  clearCustomerMemories,
} from '@/server/services/agent/customer-memory.service';
import {
  upsertCustomerMemory,
  listCustomerMemories,
  findCustomerMemoryByKey,
  deleteCustomerMemory as repoDeleteCustomerMemory,
  clearCustomerMemories as repoClearCustomerMemories,
  type CustomerMemoryRow,
} from '@/server/repositories/customer-memory.repository';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { createAITenantContext } from '@/server/services/agent/context';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import type {
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingBatchResult,
} from '@/services/ai/embedding-provider.interface';
import { ToolRegistry } from '@/server/services/agent/tools/registry';

class MockDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock_embed';
  readonly model = 'mock-embedding';
  readonly dimensions = 1536;
  async embed(): Promise<EmbeddingResult> {
    return { embedding: new Array(1536).fill(0.01), usage: { inputTokens: 5, estimated: true } };
  }
  async embedMany(texts: readonly string[]): Promise<EmbeddingBatchResult> {
    return {
      embeddings: texts.map(() => new Array(1536).fill(0.01)),
      usage: { inputTokens: 5 * texts.length, estimated: true },
    };
  }
}

describe('Customer Memory V1 — Validation & Privacy Gates', () => {
  it('identifies and rejects sensitive keys (passwords, tokens, CVVs, card numbers)', () => {
    expect(isProhibitedMemoryKey('password')).toBe(true);
    expect(isProhibitedMemoryKey('admin_password')).toBe(true);
    expect(isProhibitedMemoryKey('user_secret')).toBe(true);
    expect(isProhibitedMemoryKey('token')).toBe(true);
    expect(isProhibitedMemoryKey('auth_token')).toBe(true);
    expect(isProhibitedMemoryKey('pin')).toBe(true);
    expect(isProhibitedMemoryKey('cvv')).toBe(true);
    expect(isProhibitedMemoryKey('card_number')).toBe(true);
    expect(isProhibitedMemoryKey('credit_card')).toBe(true);
    expect(isProhibitedMemoryKey('otp')).toBe(true);
    expect(isProhibitedMemoryKey('bank_account')).toBe(true);
    expect(isProhibitedMemoryKey('cnic')).toBe(true);

    // Safe business preference keys
    expect(isProhibitedMemoryKey('preferred_size')).toBe(false);
    expect(isProhibitedMemoryKey('preferred_color')).toBe(false);
    expect(isProhibitedMemoryKey('preferred_payment_method')).toBe(false);
    expect(isProhibitedMemoryKey('delivery_preference')).toBe(false);
  });

  it('rejects creation of memory containing prohibited keys via schema validation', () => {
    const invalidInput = {
      contactId: '11111111-2222-3333-4444-555555555555',
      category: 'PREFERENCE' as const,
      key: 'credit_card_pin',
      value: '1234',
      source: 'EXPLICIT_STATEMENT' as const,
    };

    const result = createCustomerMemorySchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Sensitive keywords');
    }
  });

  it('allows valid business preferences', () => {
    const validInput = {
      contactId: '11111111-2222-3333-4444-555555555555',
      category: 'PREFERENCE' as const,
      key: 'preferred_size',
      value: 'Medium (M)',
      source: 'EXPLICIT_STATEMENT' as const,
    };

    const result = createCustomerMemorySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });
});

describe('Customer Memory V1 — Deterministic Fact Extraction', () => {
  it('extracts explicit payment preference (COD)', () => {
    const fact1 = extractDurableFactsFromMessage('Mujhe COD pasand hai');
    expect(fact1).not.toBeNull();
    expect(fact1?.key).toBe('preferred_payment_method');
    expect(fact1?.value).toBe('Cash on Delivery (COD)');
    expect(fact1?.category).toBe('PREFERENCE');

    const fact2 = extractDurableFactsFromMessage('I prefer cash on delivery for my orders');
    expect(fact2).not.toBeNull();
    expect(fact2?.key).toBe('preferred_payment_method');
    expect(fact2?.value).toBe('Cash on Delivery (COD)');
  });

  it('extracts explicit payment preference (Bank Transfer)', () => {
    const fact = extractDurableFactsFromMessage('Ab bank transfer karunga');
    expect(fact).not.toBeNull();
    expect(fact?.key).toBe('preferred_payment_method');
    expect(fact?.value).toBe('Bank Transfer');
    expect(fact?.category).toBe('PREFERENCE');
  });

  it('extracts explicit sizing preference', () => {
    const fact1 = extractDurableFactsFromMessage('Mera size Medium hai');
    expect(fact1).not.toBeNull();
    expect(fact1?.key).toBe('preferred_size');
    expect(fact1?.value).toBe('Medium (M)');

    const fact2 = extractDurableFactsFromMessage('I wear size Large in shirts');
    expect(fact2).not.toBeNull();
    expect(fact2?.key).toBe('preferred_size');
    expect(fact2?.value).toBe('Large (L)');

    const fact3 = extractDurableFactsFromMessage('Mujhe size XL chahiye');
    expect(fact3).not.toBeNull();
    expect(fact3?.key).toBe('preferred_size');
    expect(fact3?.value).toBe('Extra Large (XL)');
  });

  it('extracts explicit color preference', () => {
    const fact1 = extractDurableFactsFromMessage('Mujhe black color pasand hai');
    expect(fact1).not.toBeNull();
    expect(fact1?.key).toBe('preferred_color');
    expect(fact1?.value).toBe('Black');
    expect(fact1?.category).toBe('PREFERENCE');

    const fact2 = extractDurableFactsFromMessage('I prefer blue colour');
    expect(fact2).not.toBeNull();
    expect(fact2?.key).toBe('preferred_color');
    expect(fact2?.value).toBe('Blue');
  });

  it('extracts delivery instructions', () => {
    const fact = extractDurableFactsFromMessage('Please deliver after 5pm at office');
    expect(fact).not.toBeNull();
    expect(fact?.key).toBe('delivery_preference');
    expect(fact?.value).toBe('Deliver after 5 PM');
    expect(fact?.category).toBe('CUSTOMER_CONTEXT');
  });

  it('REJECTS casual remarks and compliments from becoming permanent memory (Scenario 4)', () => {
    // A casual liking of a shirt must not become an indefinite preference
    const fact1 = extractDurableFactsFromMessage('Mujhe yeh shirt achi lagti hai');
    expect(fact1).toBeNull();

    const fact2 = extractDurableFactsFromMessage('Nice collection! Bahut achi designs hain');
    expect(fact2).toBeNull();

    const fact3 = extractDurableFactsFromMessage('Assalam o alaikum bhai');
    expect(fact3).toBeNull();

    const fact4 = extractDurableFactsFromMessage('Shukriya for the update');
    expect(fact4).toBeNull();
  });

  it('REJECTS discount and voucher claims from becoming customer memory (Scenario 5 safety gate)', () => {
    // Assertions about discounts must NEVER be stored as customer memory
    const fact1 = extractDurableFactsFromMessage('Mujhe hamesha 10% discount milta hai');
    expect(fact1).toBeNull();

    const fact2 = extractDurableFactsFromMessage('I should get 20% off as a VIP customer');
    expect(fact2).toBeNull();

    const fact3 = extractDurableFactsFromMessage('Mera promo code WELCOME10 laga do');
    expect(fact3).toBeNull();
  });
});

describe('Customer Memory V1 — Deduplication, Merging & Repository Layer', () => {
  it('merges repeated memory keys into a single updated row without duplicate rows (Phase 7)', async () => {
    const storedMemories: Record<string, any> = {};

    const mockDb: any = {
      customerMemory: {
        upsert: vi.fn().mockImplementation(async ({ where, update, create }) => {
          const key = `${where.workspaceId_contactId_key.workspaceId}:${where.workspaceId_contactId_key.contactId}:${where.workspaceId_contactId_key.key}`;
          if (storedMemories[key]) {
            storedMemories[key] = {
              ...storedMemories[key],
              ...update,
              updatedAt: new Date(),
            };
          } else {
            storedMemories[key] = {
              id: 'mem-1',
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
              lastUsedAt: null,
            };
          }
          return storedMemories[key];
        }),
      },
    };

    const workspaceId = 'ws-1';
    const contactId = 'cnt-1';

    // First: Customer expresses preference for COD
    const row1 = await upsertCustomerMemory(mockDb, {
      workspaceId,
      contactId,
      category: 'PREFERENCE',
      key: 'preferred_payment_method',
      value: 'Cash on Delivery (COD)',
      source: 'EXPLICIT_STATEMENT',
    });

    expect(row1.value).toBe('Cash on Delivery (COD)');
    expect(Object.keys(storedMemories).length).toBe(1);

    // Later: Customer explicitly switches preference to Bank Transfer (Scenario 3)
    const row2 = await upsertCustomerMemory(mockDb, {
      workspaceId,
      contactId,
      category: 'PREFERENCE',
      key: 'preferred_payment_method',
      value: 'Bank Transfer',
      source: 'EXPLICIT_STATEMENT',
    });

    // Merged: Still only 1 record for this key, updated value
    expect(row2.value).toBe('Bank Transfer');
    expect(Object.keys(storedMemories).length).toBe(1);
    expect(storedMemories[`${workspaceId}:${contactId}:preferred_payment_method`].value).toBe('Bank Transfer');
  });

  it('deletes and clears memories with strict workspace scoping', async () => {
    const mockDb: any = {
      customerMemory: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const count = await repoClearCustomerMemories(mockDb, 'ws-1', 'cnt-1');
    expect(count).toBe(2);
    expect(mockDb.customerMemory.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        contactId: 'cnt-1',
      },
    });
  });
});

describe('Customer Memory V1 — Relevance & Prompt Budgeting', () => {
  const sampleMemories: CustomerMemoryRow[] = [
    {
      id: 'm1',
      workspaceId: 'ws-1',
      contactId: 'cnt-1',
      category: 'PREFERENCE',
      key: 'preferred_payment_method',
      value: 'Cash on Delivery (COD)',
      source: 'EXPLICIT_STATEMENT',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm2',
      workspaceId: 'ws-1',
      contactId: 'cnt-1',
      category: 'PREFERENCE',
      key: 'preferred_size',
      value: 'Medium (M)',
      source: 'ORDER_BEHAVIOR',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm3',
      workspaceId: 'ws-1',
      contactId: 'cnt-1',
      category: 'PREFERENCE',
      key: 'preferred_color',
      value: 'Black',
      source: 'EXPLICIT_STATEMENT',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm4',
      workspaceId: 'ws-1',
      contactId: 'cnt-1',
      category: 'CUSTOMER_CONTEXT',
      key: 'delivery_preference',
      value: 'Deliver after 5 PM',
      source: 'EXPLICIT_STATEMENT',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it('prioritizes payment preference when customer asks about payment methods', () => {
    const relevant = selectRelevantMemories(
      sampleMemories,
      'How can I pay for my order?',
      new Set(['PAYMENT']),
    );

    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant[0]?.key).toBe('preferred_payment_method');
  });

  it('prioritizes size and color when customer asks about catalog items', () => {
    const relevant = selectRelevantMemories(
      sampleMemories,
      'Do you have this shirt in my size and black color?',
      new Set(['CATALOG_INVENTORY']),
    );

    const keys = relevant.map((m) => m.key);
    expect(keys).toContain('preferred_size');
    expect(keys).toContain('preferred_color');
  });

  it('enforces maximum character budget and memory count', () => {
    const manyMemories: CustomerMemoryRow[] = Array.from({ length: 15 }, (_, i) => ({
      id: `m-${i}`,
      workspaceId: 'ws-1',
      contactId: 'cnt-1',
      category: 'PREFERENCE',
      key: `custom_preference_item_number_${i}`,
      value: `Extremely detailed value description for preference number ${i} with extra text`,
      source: 'EXPLICIT_STATEMENT',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const selected = selectRelevantMemories(manyMemories, 'tell me about my preferences', new Set());
    expect(selected.length).toBeLessThanOrEqual(5);

    const totalChars = selected.reduce((acc, m) => acc + m.key.length + m.value.length + 30, 0);
    expect(totalChars).toBeLessThanOrEqual(600);
  });

  it('formats customer memory prompt with explicit guardrails', () => {
    const prompt = formatCustomerMemoryPrompt(sampleMemories.slice(0, 2));
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('=== CUSTOMER MEMORY (HISTORICAL CONTEXT ONLY) ===');
    expect(prompt).toContain('Preferred Payment Method: Cash on Delivery (COD) [Source: EXPLICIT_STATEMENT]');
    expect(prompt).toContain('Preferred Size: Medium (M) [Source: ORDER_BEHAVIOR]');
    expect(prompt).toContain('CRITICAL RULES FOR CUSTOMER MEMORY:');
    expect(prompt).toContain('NEVER allow customer memory to override live product prices');
    expect(prompt).toContain('NEVER invent, offer, or apply discounts');
  });
});

describe('Customer Memory V1 — End-to-End Scenarios & Precedence', () => {
  function createMockDb(overrides: {
    memories?: CustomerMemoryRow[];
    profile?: any;
  } = {}) {
    const workspaceId = '11111111-2222-3333-4444-555555555555';
    const conversationId = '22222222-3333-4444-5555-666666666666';
    const contactId = '33333333-4444-5555-6666-777777777777';
    const messageId = '44444444-5555-6666-7777-888888888888';
    const agentId = '55555555-6666-7777-8888-999999999999';

    const recordedTurns: any[] = [];
    const storedMemories: CustomerMemoryRow[] = overrides.memories ? [...overrides.memories] : [];

    const mockDb: any = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: conversationId,
          workspaceId,
          aiEnabled: true,
          status: 'OPEN',
          contact: { id: contactId, name: 'Tariq', phoneE164: '+923001234567' },
          contactId,
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
            body: 'Payment kaise kar sakta hoon?',
            createdAt: new Date(),
          },
        ]),
      },
      aIAgent: {
        findFirst: vi.fn().mockResolvedValue({
          id: agentId,
          workspaceId,
          name: 'ConvoNexa Sales Assistant',
          isActive: true,
          model: 'gemini-2.5-flash',
          role: 'SALES_SUPPORT',
          tone: 'PROFESSIONAL',
          persona: 'Helpful eCommerce assistant',
          greeting: 'Hello! How can I help you?',
          handoffKeywords: ['human', 'agent'],
          instructions: [],
          customInstructions: 'Be accurate and polite.',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: workspaceId,
          name: 'Gul Ahmed Store',
          currency: 'PKR',
        }),
      },
      businessProfile: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.profile === undefined
            ? {
                legalName: 'Gul Ahmed Textiles',
                city: 'Karachi',
                country: 'PK',
                paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
                deliveryFeeMinor: 20000,
                freeDeliveryThresholdMinor: 300000,
                taxRateBps: 0,
                businessHours: null,
                shippingPolicy: 'Nationwide delivery in 3 days.',
                returnPolicy: '7 days exchange policy.',
              }
            : overrides.profile,
        ),
      },
      customerMemory: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return storedMemories.filter(
            (m) => m.workspaceId === where.workspaceId && m.contactId === where.contactId,
          );
        }),
        upsert: vi.fn().mockImplementation(async ({ where, update, create }) => {
          const idx = storedMemories.findIndex(
            (m) =>
              m.workspaceId === where.workspaceId_contactId_key.workspaceId &&
              m.contactId === where.workspaceId_contactId_key.contactId &&
              m.key === where.workspaceId_contactId_key.key,
          );
          if (idx >= 0) {
            storedMemories[idx] = { ...storedMemories[idx], ...update, updatedAt: new Date() };
            return storedMemories[idx];
          } else {
            const created = {
              id: `mem-${Date.now()}`,
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
              lastUsedAt: null,
            };
            storedMemories.push(created);
            return created;
          }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      knowledgeBase: {
        findUnique: vi.fn().mockResolvedValue(null),
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
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return callback(mockDb);
        }
        return callback;
      }),
      _recordedTurns: recordedTurns,
      _storedMemories: storedMemories,
    };

    return { mockDb, workspaceId, conversationId, contactId, messageId };
  }

  it('Scenario 1 — Preference: AI receives customer COD preference contextually', async () => {
    const existingMemories: CustomerMemoryRow[] = [
      {
        id: 'mem-cod',
        workspaceId: '11111111-2222-3333-4444-555555555555',
        contactId: '33333333-4444-5555-6666-777777777777',
        category: 'PREFERENCE',
        key: 'preferred_payment_method',
        value: 'Cash on Delivery (COD)',
        source: 'EXPLICIT_STATEMENT',
        confidence: 1.0,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      memories: existingMemories,
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'You can pay via Cash on Delivery (COD) as you usually prefer, or via Bank Transfer.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 30 },
      },
    });

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: new MockDeterministicEmbeddingProvider(),
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.customerMemoryCount).toBe(1);

    // Verify system prompt contained the customer memory section
    const sentMessages = provider.callHistory[0]?.messages ?? [];
    const systemPrompt = sentMessages.find((m) => m.role === 'system')?.content;
    expect(systemPrompt).toContain('=== CUSTOMER MEMORY (HISTORICAL CONTEXT ONLY) ===');
    expect(systemPrompt).toContain('Preferred Payment Method: Cash on Delivery (COD)');
  });

  it('Scenario 2 — Previous product / Sizing: Memory provides context but live tools remain authoritative for stock', async () => {
    const existingMemories: CustomerMemoryRow[] = [
      {
        id: 'mem-size',
        workspaceId: '11111111-2222-3333-4444-555555555555',
        contactId: '33333333-4444-5555-6666-777777777777',
        category: 'PREFERENCE',
        key: 'preferred_size',
        value: 'Medium (M)',
        source: 'ORDER_BEHAVIOR',
        confidence: 1.0,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'mem-prod',
        workspaceId: '11111111-2222-3333-4444-555555555555',
        contactId: '33333333-4444-5555-6666-777777777777',
        category: 'PRODUCT_INTEREST',
        key: 'last_purchased_product',
        value: 'Black Oxford Shirt',
        source: 'ORDER_BEHAVIOR',
        confidence: 1.0,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      memories: existingMemories,
    });

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Mujhe wohi wali shirt dobara chahiye.',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    // Turn 1: Model uses tool to check live inventory for the previously purchased product in Medium
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-check-inv-1',
              name: 'check_inventory',
              arguments: { variantId: 'var-black-oxford-m' },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 150, outputTokens: 25 },
      },
    });

    // Turn 2: Assistant responds with live inventory confirmation
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Your previous Black Oxford Shirt in Medium (M) is currently in stock! Would you like me to place the order for you?',
        },
        finishReason: 'stop',
        usage: { inputTokens: 180, outputTokens: 35 },
      },
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'check_inventory',
      description: 'Check stock',
      inputSchema: z.object({ variantId: z.string() }),
      classification: 'READ',
      capabilityRequired: 'products:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => ({ inStock: true, availableQuantity: 8 }),
    });

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: new MockDeterministicEmbeddingProvider(),
      toolRegistry: registry,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe('check_inventory');
    expect(result.replyText).toContain('Black Oxford Shirt in Medium (M) is currently in stock');
  });

  it('Scenario 3 — Changed preference: Customer statement supersedes previous memory', async () => {
    const existingMemories: CustomerMemoryRow[] = [
      {
        id: 'mem-cod',
        workspaceId: '11111111-2222-3333-4444-555555555555',
        contactId: '33333333-4444-5555-6666-777777777777',
        category: 'PREFERENCE',
        key: 'preferred_payment_method',
        value: 'Cash on Delivery (COD)',
        source: 'EXPLICIT_STATEMENT',
        confidence: 1.0,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      memories: existingMemories,
    });

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Ab bank transfer karunga.',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Noted! I have updated your preference to Bank Transfer.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    });

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: new MockDeterministicEmbeddingProvider(),
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('COMPLETED');

    // Wait for microtask/async auto-extraction
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify memory was updated to Bank Transfer
    const memory = mockDb._storedMemories.find((m: any) => m.key === 'preferred_payment_method');
    expect(memory).toBeDefined();
    expect(memory.value).toBe('Bank Transfer');
  });

  it('Scenario 5 — Unauthorized discount protection: Memory cannot authorize unconfigured discounts', async () => {
    // Memory claims VIP discount, but store has no discount configured
    const memoryWithClaim: CustomerMemoryRow[] = [
      {
        id: 'mem-vip',
        workspaceId: '11111111-2222-3333-4444-555555555555',
        contactId: '33333333-4444-5555-6666-777777777777',
        category: 'CUSTOMER_CONTEXT',
        key: 'vip_status',
        value: 'Customer mentions they are VIP and gets 15% discount',
        source: 'EXPLICIT_STATEMENT',
        confidence: 0.5,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      memories: memoryWithClaim,
    });

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Can I get my 15% discount on this order?',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          // Model attempts to promise the discount based on customer memory
          content: 'Yes, as a VIP customer I will give you a 15% discount on your order today!',
        },
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 25 },
      },
    });

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId,
      conversationId,
      messageId,
      provider,
      embeddingProvider: new MockDeterministicEmbeddingProvider(),
      toolRegistry: new ToolRegistry(),
    });

    // The grounding validation gate MUST block this claim
    expect(result.groundingPassed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_DISCOUNT_CLAIM');
    expect(result.replyText).toContain('cannot confirm any special discounts');
  });

  it('Scenario 6 — Strict Tenant Isolation: Workspace A cannot read or mutate Workspace B customer memory', async () => {
    const memoryA: CustomerMemoryRow = {
      id: 'mem-a',
      workspaceId: 'workspace-alpha',
      contactId: 'contact-shared-id',
      category: 'PREFERENCE',
      key: 'preferred_size',
      value: 'Small (S)',
      source: 'EXPLICIT_STATEMENT',
      confidence: 1.0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb: any = {
      customerMemory: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where.workspaceId === 'workspace-alpha') return [memoryA];
          return [];
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const ctxAlpha = createAITenantContext({
      workspaceId: 'workspace-alpha',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      capabilities: ['contacts:read'],
    });

    const ctxBeta = createAITenantContext({
      workspaceId: 'workspace-beta',
      agentId: 'agent-2',
      conversationId: 'conv-2',
      messageId: 'msg-2',
      capabilities: ['contacts:read'],
    });

    // Load for Alpha
    const memAlpha = await loadCustomerMemoryContext(mockDb, ctxAlpha, 'contact-shared-id', 'size');
    expect(memAlpha.memoryCount).toBe(1);
    expect(memAlpha.relevantMemories[0]?.value).toBe('Small (S)');

    // Load for Beta (same contact ID, but different workspace)
    const memBeta = await loadCustomerMemoryContext(mockDb, ctxBeta, 'contact-shared-id', 'size');
    expect(memBeta.memoryCount).toBe(0);
    expect(memBeta.relevantMemories.length).toBe(0);
    expect(memBeta.formattedContext).toBeNull();
  });
});
