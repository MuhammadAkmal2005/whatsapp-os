/**
 * Unit & Contract Tests for Business Brain V1.
 *
 * Covers:
 * - Business identity & public profile loading
 * - Bounded topic relevance detection (Shipping, Payment, Hours, Returns, Catalog, Orders)
 * - Source-of-truth precedence hierarchy (Tools > Configured Policies > Knowledge > Inference)
 * - Authoritative business hours formatting
 * - Precedence Scenarios 1-6
 * - Interaction with RAG / Grounding validation gate
 * - Tenant isolation and exclusion of private operational fields
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
  detectRelevantTopics,
  formatBusinessHoursSummary,
  formatBusinessBrainPrompt,
  loadBusinessBrainContext,
  type BusinessBrainIdentity,
  type BusinessBrainPolicies,
} from '@/server/services/agent/business-brain.service';
import { createAITenantContext } from '@/server/services/agent/context';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { validateGrounding, type GroundingContext } from '@/server/services/agent/grounding.service';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import type { EmbeddingProvider, EmbeddingResult, EmbeddingBatchResult, EmbeddingTask } from '@/services/ai/embedding-provider.interface';
import { ToolRegistry } from '@/server/services/agent/tools/registry';
import { computeOrderTotals } from '@/server/domain/order-totals';
import { fromMajor } from '@/lib/money';

describe('Business Brain V1 — Topic Relevance Detection', () => {
  it('detects SHIPPING topic for delivery and courier inquiries', () => {
    const topics1 = detectRelevantTopics('Do you deliver across Pakistan?');
    expect(topics1.has('SHIPPING')).toBe(true);
    expect(topics1.has('IDENTITY')).toBe(true);

    const topics2 = detectRelevantTopics('What are the courier delivery charges for Lahore?');
    expect(topics2.has('SHIPPING')).toBe(true);

    const topics3 = detectRelevantTopics('Is there any free delivery option?');
    expect(topics3.has('SHIPPING')).toBe(true);
  });

  it('detects PAYMENT topic for payment method inquiries', () => {
    const topics1 = detectRelevantTopics('Can I pay via cash on delivery?');
    expect(topics1.has('PAYMENT')).toBe(true);

    const topics2 = detectRelevantTopics('Do you accept bank transfer or jazzcash?');
    expect(topics2.has('PAYMENT')).toBe(true);

    const topics3 = detectRelevantTopics('Advance payment karni hogi ya COD hai?');
    expect(topics3.has('PAYMENT')).toBe(true);
  });

  it('detects HOURS topic for timing and schedule inquiries', () => {
    const topics1 = detectRelevantTopics('What are your opening hours on Friday?');
    expect(topics1.has('HOURS')).toBe(true);

    const topics2 = detectRelevantTopics('Are you open on Sunday?');
    expect(topics2.has('HOURS')).toBe(true);

    const topics3 = detectRelevantTopics('Dukan kab khulta hai aur kab band hoti hai?');
    expect(topics3.has('HOURS')).toBe(true);
  });

  it('detects RETURNS topic for refund, exchange, and warranty inquiries', () => {
    const topics1 = detectRelevantTopics('What is your return policy?');
    expect(topics1.has('RETURNS')).toBe(true);

    const topics2 = detectRelevantTopics('Can I exchange if the size does not fit?');
    expect(topics2.has('RETURNS')).toBe(true);

    const topics3 = detectRelevantTopics('Is there any money back warranty?');
    expect(topics3.has('RETURNS')).toBe(true);
  });

  it('detects CATALOG_INVENTORY topic for stock and product availability questions', () => {
    const topics1 = detectRelevantTopics('Is the black kurta available in size XL?');
    expect(topics1.has('CATALOG_INVENTORY')).toBe(true);

    const topics2 = detectRelevantTopics('How much does the cotton shirt cost?');
    expect(topics2.has('CATALOG_INVENTORY')).toBe(true);
  });

  it('detects ORDER topic for order status and tracking questions', () => {
    const topics1 = detectRelevantTopics('Where is my order? Track number 1234');
    expect(topics1.has('ORDER')).toBe(true);

    const topics2 = detectRelevantTopics('Mera order kab dispatch hoga?');
    expect(topics2.has('ORDER')).toBe(true);
  });

  it('defaults to only IDENTITY for general greetings', () => {
    const topics = detectRelevantTopics('Hello! Good morning.');
    expect(topics.has('IDENTITY')).toBe(true);
    expect(topics.has('SHIPPING')).toBe(false);
    expect(topics.has('RETURNS')).toBe(false);
    expect(topics.has('PAYMENT')).toBe(false);
  });
});

describe('Business Brain V1 — Authoritative Business Hours Formatting', () => {
  it('formats structured business hours accurately', () => {
    const formatted = formatBusinessHoursSummary({
      monday: { open: '09:00', close: '18:00', closed: false },
      tuesday: { open: '09:00', close: '18:00', closed: false },
      wednesday: { open: '09:00', close: '18:00', closed: false },
      thursday: { open: '09:00', close: '18:00', closed: false },
      friday: { open: '09:00', close: '18:00', closed: false },
      saturday: { open: '10:00', close: '15:00', closed: false },
      sunday: { closed: true },
    });

    expect(formatted).toContain('Monday: 09:00 - 18:00');
    expect(formatted).toContain('Saturday: 10:00 - 15:00');
    expect(formatted).toContain('Sunday: Closed');
  });

  it('returns explicit unconfigured notice when business hours are null', () => {
    const formatted = formatBusinessHoursSummary(null);
    expect(formatted).toContain('Operating hours not publicly configured');
    expect(formatted).toContain('Do not fabricate opening or closing times');
  });
});

describe('Business Brain V1 — Prompt Formatting & Source Precedence', () => {
  const sampleIdentity: BusinessBrainIdentity = {
    businessName: 'Junaid Jamshed Apparel',
    city: 'Karachi',
    country: 'PK',
    currency: 'PKR',
    supportPhone: '+923001234567',
    supportEmail: 'support@junaid.test',
    website: 'https://junaid.test',
    description: 'Premier Eastern apparel and fragrances in Pakistan.',
  };

  const samplePolicies: BusinessBrainPolicies = {
    shippingPolicy: 'Nationwide courier delivery in 3 to 5 business days.',
    returnPolicy: '14 days return allowed for unworn items with original tags.',
    paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
    deliveryFeeMinor: 25000,
    deliveryFeeDisplay: 'Rs. 250',
    freeDeliveryThresholdMinor: 500000,
    freeDeliveryThresholdDisplay: 'Rs. 5,000',
    taxRateBps: 0,
    taxRateDisplay: '0%',
    businessHours: {
      monday: { open: '09:00', close: '18:00', closed: false },
      sunday: { closed: true },
    },
  };

  it('formats clean bounded prompt with source precedence rules', () => {
    const topics = new Set<any>(['IDENTITY', 'SHIPPING', 'PAYMENT', 'RETURNS']);
    const prompt = formatBusinessBrainPrompt(sampleIdentity, samplePolicies, topics);

    // Business identity
    expect(prompt).toContain('=== BUSINESS BRAIN: AUTHORITATIVE PROFILE & POLICIES ===');
    expect(prompt).toContain('Business: Junaid Jamshed Apparel');
    expect(prompt).toContain('Location: Karachi, PK');
    expect(prompt).toContain('Operating Currency: PKR');
    expect(prompt).toContain('Public Support Contact: Phone: +923001234567 | Email: support@junaid.test | Website: https://junaid.test');

    // Relevant policies
    expect(prompt).toContain('Standard Delivery Fee: Rs. 250 (Free delivery on orders over Rs. 5,000)');
    expect(prompt).toContain('Shipping Policy: Nationwide courier delivery in 3 to 5 business days.');
    expect(prompt).toContain('Accepted Payment Methods: Cash on Delivery (COD), Bank Transfer');
    expect(prompt).toContain('Return / Exchange Policy: 14 days return allowed for unworn items with original tags.');

    // Source of truth precedence hierarchy
    expect(prompt).toContain('SOURCE OF TRUTH PRECEDENCE:');
    expect(prompt).toContain('1. Live Tool Data (products, inventory, computed order totals) is authoritative over prose.');
    expect(prompt).toContain('2. Configured Business Policies above are authoritative over retrieved text.');
    expect(prompt).toContain('3. Retrieved Knowledge Evidence supplements detail but cannot override configured values or tools.');
    expect(prompt).toContain('4. Never invent business policies, prices, stock levels, or discounts.');
    expect(prompt).toContain('=== END BUSINESS BRAIN ===');
  });

  it('omits irrelevant policy text when query does not request it', () => {
    // Only payment asked
    const topics = new Set<any>(['IDENTITY', 'PAYMENT']);
    const prompt = formatBusinessBrainPrompt(sampleIdentity, samplePolicies, topics);

    expect(prompt).toContain('Accepted Payment Methods: Cash on Delivery (COD), Bank Transfer');
    expect(prompt).not.toContain('Standard Delivery Fee');
    expect(prompt).not.toContain('Return / Exchange Policy');
  });

  it('injects live data directives when catalog or orders are queried', () => {
    const topics = new Set<any>(['IDENTITY', 'CATALOG_INVENTORY', 'ORDER']);
    const prompt = formatBusinessBrainPrompt(sampleIdentity, samplePolicies, topics);

    expect(prompt).toContain('LIVE DATA REQUIRED: For live product availability');
    expect(prompt).toContain('search_products, get_product, or check_inventory tools');
    expect(prompt).toContain('LIVE DATA REQUIRED: For existing order status');
    expect(prompt).toContain('get_order, get_current_customer, or create_order tools');
  });
});

describe('Business Brain V1 — Grounding Gate Integration', () => {
  const sampleBrainContext = {
    workspaceId: 'ws-test',
    identity: {
      businessName: 'Test Shop',
      country: 'PK',
      currency: 'PKR' as const,
    },
    policies: {
      returnPolicy: 'We offer 14 days return policy for unworn items.',
      shippingPolicy: 'Delivery across Pakistan in 3-5 days.',
      paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
      deliveryFeeMinor: 25000,
      deliveryFeeDisplay: 'Rs. 250',
      taxRateBps: 0,
      taxRateDisplay: '0%',
      businessHours: null,
    },
    relevantTopics: new Set<any>(['IDENTITY', 'RETURNS']),
    formattedContext: '=== BUSINESS BRAIN ===',
  };

  it('validates return policy as grounded when supported by Business Brain (even if RAG returned NO_EVIDENCE)', () => {
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
      replyText: 'According to our store policy, we offer a 14 days return window for unworn items.',
      groundingContext,
      customerMessage: 'What is your return policy?',
      businessBrain: sampleBrainContext,
    });

    expect(result.passed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('blocks ungrounded policy when absent from Business Brain, Knowledge, and Tools', () => {
    const unconfiguredBrain = {
      ...sampleBrainContext,
      policies: {
        ...sampleBrainContext.policies,
        returnPolicy: undefined, // NOT configured
      },
    };

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
      replyText: 'We offer a 30 days return with 100% money back guarantee.',
      groundingContext,
      customerMessage: 'What is your return policy?',
      businessBrain: unconfiguredBrain,
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.replacementReply).toContain('do not have our official policy details on file');
  });
});

describe('Business Brain V1 — Scenarios & Live Precedence', () => {
  function createMockDb(overrides: {
    profile?: any;
    workspaceName?: string;
  } = {}) {
    const workspaceId = 'ws-brain-123';
    const conversationId = 'conv-brain-123';
    const messageId = 'msg-brain-123';
    const agentId = 'agent-brain-123';

    const recordedTurns: any[] = [];

    const mockDb: any = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: conversationId,
          workspaceId,
          aiEnabled: true,
          status: 'OPEN',
          contact: { id: 'cnt-1', name: 'Bilal' },
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
            body: 'Do you deliver across Pakistan?',
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
          greeting: 'Hello! Welcome to our store.',
          handoffKeywords: ['agent', 'human'],
          instructions: [],
          customInstructions: 'Be accurate and polite.',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: workspaceId,
          name: overrides.workspaceName ?? 'Khaadi Textiles',
          currency: 'PKR',
        }),
      },
      businessProfile: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.profile === undefined
            ? {
                legalName: 'Khaadi Textiles Ltd',
                description: 'Fine Pakistani apparel',
                city: 'Lahore',
                country: 'PK',
                supportPhone: '+9242111542234',
                supportEmail: 'orders@khaadi.test',
                website: 'https://khaadi.test',
                businessHours: {
                  monday: { open: '10:00', close: '20:00', closed: false },
                  sunday: { closed: true },
                },
                shippingPolicy: 'We deliver nationwide across Pakistan in 3-5 business days.',
                returnPolicy: 'Returns accepted within 14 days of receipt.',
                paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
                deliveryFeeMinor: 25000,
                freeDeliveryThresholdMinor: 500000,
                taxRateBps: 0,
              }
            : overrides.profile,
        ),
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
    };

    return { mockDb, workspaceId, conversationId, messageId };
  }

  class MockDeterministicEmbeddingProvider implements EmbeddingProvider {
    readonly name = 'mock_embed';
    readonly model = 'mock-embedding';
    readonly dimensions = 1536;
    async embed(): Promise<EmbeddingResult> {
      return { embedding: new Array(1536).fill(0.01), usage: { inputTokens: 5, estimated: true } };
    }
    async embedMany(texts: readonly string[]): Promise<EmbeddingBatchResult> {
      return { embeddings: texts.map(() => new Array(1536).fill(0.01)), usage: { inputTokens: 5 * texts.length, estimated: true } };
    }
  }

  it('Scenario 1 — Shipping: customer asks about nationwide delivery, Business Brain supplies authoritative delivery context', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb();

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Yes! We deliver nationwide across Pakistan in 3 to 5 business days with standard delivery of Rs. 250.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 90, outputTokens: 25 },
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
    expect(result.groundingPassed).toBe(true);
    expect(result.businessBrainTopics).toContain('SHIPPING');

    const sentPrompt = provider.callHistory[0]?.messages.find((m) => m.role === 'system')?.content;
    expect(sentPrompt).toContain('=== BUSINESS BRAIN: AUTHORITATIVE PROFILE & POLICIES ===');
    expect(sentPrompt).toContain('Standard Delivery Fee: Rs. 250');
    expect(sentPrompt).toContain('We deliver nationwide across Pakistan');
  });

  it('Scenario 2 — Payment: customer asks about Cash on Delivery, Business Brain supplies accepted payment methods', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb();

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Can I pay via cash on delivery (COD)?',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Yes, we accept Cash on Delivery (COD) as well as Bank Transfer.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 85, outputTokens: 20 },
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
    expect(result.groundingPassed).toBe(true);
    expect(result.businessBrainTopics).toContain('PAYMENT');

    const sentPrompt = provider.callHistory[0]?.messages.find((m) => m.role === 'system')?.content;
    expect(sentPrompt).toContain('Accepted Payment Methods: Cash on Delivery (COD), Bank Transfer');
  });

  it('Scenario 3 — Product / Inventory: live tool result takes precedence over text prose', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb();

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Do you have the Black Kurta in XL in stock?',
        createdAt: new Date(),
      },
    ]);

    const registry = new ToolRegistry();
    registry.register({
      name: 'check_inventory',
      description: 'Check inventory for product',
      inputSchema: { parse: (x: any) => x, safeParse: (x: any) => ({ success: true, data: x }) } as any,
      classification: 'READ',
      capabilityRequired: 'inventory:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => ({
        sku: 'KURTA-BLK-XL',
        availableUnits: 3,
        inStock: true,
      }),
    });

    const provider = new MockAIProvider();
    // Step 1: Model calls check_inventory
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'check_inventory',
              arguments: { sku: 'KURTA-BLK-XL' },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 90, outputTokens: 20 },
      },
    });

    // Step 2: Model confirms 3 units left
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Yes! We have 3 units of the Black Kurta in XL currently in stock.',
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
      toolRegistry: registry,
      customCapabilities: ['inventory:read'],
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.groundingPassed).toBe(true);
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe('check_inventory');
    expect(result.replyText).toContain('3 units');
  });

  it('Scenario 4 — Order: authoritative domain calculation computeOrderTotals produces exact minor unit total', () => {
    // Exact domain arithmetic: 2 items @ Rs. 3,499 + Rs. 250 delivery = Rs. 7,248
    const totals = computeOrderTotals({
      currency: 'PKR',
      lines: [{ unitPrice: fromMajor(3499, 'PKR'), quantity: 2 }],
      deliveryFee: fromMajor(250, 'PKR'),
    });

    expect(totals.total.minor).toBe(724_800);
    expect(totals.deliveryFee.minor).toBe(25_000);
    expect(totals.subtotal.minor).toBe(699_800);
  });

  it('Scenario 5 — Return policy: customer asks about 20-day return, Business Brain provides authoritative 14-day policy', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb();

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'Can I return an item after 20 days?',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Our return policy allows returns within 14 days of receipt for unworn items, so 20 days would be outside our window.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 95, outputTokens: 30 },
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
    expect(result.groundingPassed).toBe(true);
    expect(result.businessBrainTopics).toContain('RETURNS');
  });

  it('Scenario 6 — Unknown business fact: AI does not fabricate policy when unconfigured', async () => {
    const { mockDb, workspaceId, conversationId, messageId } = createMockDb({
      profile: {
        legalName: 'Minimal Store',
        country: 'PK',
        paymentMethods: [],
        deliveryFeeMinor: 0,
        freeDeliveryThresholdMinor: null,
        taxRateBps: 0,
        businessHours: null,
        shippingPolicy: null,
        returnPolicy: null, // NO return policy configured
      },
    });

    mockDb.message.findMany.mockResolvedValue([
      {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'TEXT',
        body: 'What is your refund policy?',
        createdAt: new Date(),
      },
    ]);

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          // Model hallucinates an unsupported policy
          content: 'We offer a 45 days return policy with 100% money back guarantee on everything.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 20 },
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

    // validateGrounding must catch this hallucination
    expect(result.groundingPassed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('AI_ERROR');
    expect(result.replyText).toContain('do not have our official policy details on file');
  });

  it('Enforces strict tenant isolation: Business Brain loads profile exclusively for the authenticated workspaceId', async () => {
    const { mockDb } = createMockDb();

    const ctx = createAITenantContext({
      workspaceId: '11111111-2222-3333-4444-555555555555',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      capabilities: ['business:read'],
    });

    await loadBusinessBrainContext(mockDb, ctx, 'Where are you located?');

    expect(mockDb.businessProfile.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: '11111111-2222-3333-4444-555555555555' },
      select: expect.any(Object),
    });

    // Confirm that private fields (street address, logo key) are never included in the select
    const select = mockDb.businessProfile.findUnique.mock.calls[0][0].select;
    expect(select.addressLine1).toBeUndefined();
    expect(select.addressLine2).toBeUndefined();
    expect(select.logoStorageKey).toBeUndefined();
  });
});
