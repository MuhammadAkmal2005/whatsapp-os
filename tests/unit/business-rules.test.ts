/**
 * Unit & Integration Tests for Business Rules / Policy Intelligence V1.
 *
 * Validates deterministic rule evaluations across:
 * - Payment methods (allowed, disallowed, customer memory conflict resolution)
 * - Returns / exchanges (within window, outside window, conflicting knowledge sources)
 * - Shipping / delivery (standard fee, free delivery threshold, geographic boundaries)
 * - Business hours (within hours, outside hours, preventing false human availability claims)
 * - Discounts / promotional authority (unauthorized discounts blocked, memory assertions rejected)
 * - Order modifications (autonomous mutations blocked, human handoff enforced)
 * - Grounding validation gate integration
 * - Realistic Scenarios 1 to 7
 * - Source-of-truth precedence hierarchy (Levels 1 to 5)
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
  evaluateBusinessRules,
  extractRequestedReturnDays,
  extractReturnWindowDays,
  isPaymentMethodSupported,
  isWithinBusinessHours,
  normalizePaymentMethodCode,
} from '@/server/services/agent/business-rules.service';
import type {
  BusinessBrainIdentity,
  BusinessBrainPolicies,
} from '@/server/services/agent/business-brain.service';
import { validateGrounding, type GroundingContext } from '@/server/services/agent/grounding.service';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import { ToolRegistry } from '@/server/services/agent/tools/registry';
import { computeOrderTotals } from '@/server/domain/order-totals';
import { fromMajor } from '@/lib/money';

// Standard test fixtures
const TEST_IDENTITY: BusinessBrainIdentity = {
  businessName: 'Al-Karam Studio',
  city: 'Karachi',
  country: 'PK',
  currency: 'PKR',
  description: 'Premium Pakistani apparel and fabrics.',
  supportPhone: '+923001234567',
  supportEmail: 'support@alkaram.test',
};

const BASE_POLICIES: BusinessBrainPolicies = {
  shippingPolicy: 'Nationwide delivery across Pakistan in 3 to 5 business days.',
  returnPolicy: '14-day return policy for unused items with original tags.',
  paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
  deliveryFeeMinor: 25000, // Rs. 250
  deliveryFeeDisplay: 'Rs. 250',
  freeDeliveryThresholdMinor: 500000, // Rs. 5,000
  freeDeliveryThresholdDisplay: 'Rs. 5,000',
  taxRateBps: 0,
  taxRateDisplay: '0%',
  businessHours: {
    monday: { open: '09:00', close: '18:00', closed: false },
    tuesday: { open: '09:00', close: '18:00', closed: false },
    wednesday: { open: '09:00', close: '18:00', closed: false },
    thursday: { open: '09:00', close: '18:00', closed: false },
    friday: { open: '09:00', close: '18:00', closed: false },
    saturday: { open: '10:00', close: '16:00', closed: false },
    sunday: { closed: true },
  },
};

describe('Business Rules V1 — Parsing & Helper Utilities', () => {
  it('extracts return window days from structured return policies', () => {
    expect(extractReturnWindowDays('14-day return policy')).toBe(14);
    expect(extractReturnWindowDays('Returns accepted within 30 days of purchase')).toBe(30);
    expect(extractReturnWindowDays('7 din wapsi ki policy hai')).toBe(7);
    expect(extractReturnWindowDays('No returns accepted')).toBeNull();
    expect(extractReturnWindowDays(null)).toBeNull();
  });

  it('extracts requested return days from customer queries', () => {
    expect(extractRequestedReturnDays('10 din baad return kar sakta hoon?')).toBe(10);
    expect(extractRequestedReturnDays('Can I return after 20 days?')).toBe(20);
    expect(extractRequestedReturnDays('Is return possible within 5 days?')).toBe(5);
    expect(extractRequestedReturnDays('How do I return?')).toBeNull();
  });

  it('normalizes payment method codes accurately', () => {
    expect(normalizePaymentMethodCode('cod')).toBe('CASH_ON_DELIVERY');
    expect(normalizePaymentMethodCode('Cash on Delivery')).toBe('CASH_ON_DELIVERY');
    expect(normalizePaymentMethodCode('bank transfer')).toBe('BANK_TRANSFER');
    expect(normalizePaymentMethodCode('credit card')).toBe('CARD');
    expect(normalizePaymentMethodCode('jazzcash')).toBe('JAZZCASH');
    expect(normalizePaymentMethodCode('easypaisa')).toBe('EASYPAISA');
  });

  it('checks configured payment method support', () => {
    const configured = ['CASH_ON_DELIVERY', 'BANK_TRANSFER'];
    expect(isPaymentMethodSupported('COD', configured)).toBe(true);
    expect(isPaymentMethodSupported('bank', configured)).toBe(true);
    expect(isPaymentMethodSupported('card', configured)).toBe(false);
    expect(isPaymentMethodSupported('jazzcash', configured)).toBe(false);
  });

  it('evaluates business hours correctly across open and closed times', () => {
    const hours = BASE_POLICIES.businessHours!;

    // Monday at 14:00 (inside 09:00 - 18:00)
    const mondayOpen = new Date('2026-09-07T14:00:00+05:00');
    const openCheck = isWithinBusinessHours(hours, mondayOpen, 'Asia/Karachi');
    expect(openCheck.isOpen).toBe(true);

    // Monday at 21:00 (after 18:00 close)
    const mondayClosed = new Date('2026-09-07T21:00:00+05:00');
    const closedCheck = isWithinBusinessHours(hours, mondayClosed, 'Asia/Karachi');
    expect(closedCheck.isOpen).toBe(false);

    // Sunday (configured closed)
    const sunday = new Date('2026-09-06T12:00:00+05:00');
    const sundayCheck = isWithinBusinessHours(hours, sunday, 'Asia/Karachi');
    expect(sundayCheck.isOpen).toBe(false);

    // Null business hours
    const nullCheck = isWithinBusinessHours(null, mondayOpen);
    expect(nullCheck.isOpen).toBe(false);
    expect(nullCheck.reason).toContain('not configured');
  });
});

describe('Business Rules V1 — Deterministic Rule Evaluation', () => {
  it('evaluates payment method rules (allowed configured vs disallowed unconfigured)', () => {
    // 1. Allowed COD
    const resCod = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'COD available hai?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const codEval = resCod.evaluations.find((e) => e.category === 'PAYMENT');
    expect(codEval?.outcome).toBe('ALLOWED');
    expect(codEval?.directive).toContain('Cash on Delivery (COD) is supported');

    // 2. Disallowed unconfigured method (e.g. JazzCash not enabled)
    const resJazz = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Can I pay via JazzCash?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const jazzEval = resJazz.evaluations.find((e) => e.category === 'PAYMENT');
    expect(jazzEval?.outcome).toBe('NOT_ALLOWED');
    expect(jazzEval?.directive).toContain('NOT supported');
  });

  it('enforces Business Rules over Customer Memory (Level 2 > Level 4)', () => {
    // Business profile has COD disabled
    const noCodPolicies: BusinessBrainPolicies = {
      ...BASE_POLICIES,
      paymentMethods: ['BANK_TRANSFER'],
    };

    // Customer Memory says customer prefers COD
    const memories = [
      {
        category: 'PREFERENCE',
        key: 'preferred_payment_method',
        value: 'Customer prefers Cash on Delivery (COD)',
      },
    ];

    const res = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'COD se pay karna chahta hoon',
      policies: noCodPolicies,
      identity: TEST_IDENTITY,
      customerMemories: memories,
    });

    const paymentEval = res.evaluations.find((e) => e.category === 'PAYMENT');
    expect(paymentEval?.outcome).toBe('NOT_ALLOWED');
    expect(paymentEval?.reason).toContain('overriding customer memory preference');
    expect(paymentEval?.directive).toContain('Cash on Delivery (COD) is NOT accepted');
  });

  it('evaluates return window rules (allowed within window vs disallowed outside window)', () => {
    // Query within 14-day window: 10 days
    const resAllowed = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: '10 din baad return kar sakta hoon?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const returnAllowed = resAllowed.evaluations.find((e) => e.category === 'RETURNS');
    expect(returnAllowed?.outcome).toBe('ALLOWED');
    expect(returnAllowed?.directive).toContain('Returns within 14 days are permitted');

    // Query outside 14-day window: 20 days
    const resDisallowed = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: '20 din baad return kar sakta hoon?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const returnDisallowed = resDisallowed.evaluations.find((e) => e.category === 'RETURNS');
    expect(returnDisallowed?.outcome).toBe('NOT_ALLOWED');
    expect(returnDisallowed?.directive).toContain('EXCEEDS the official 14-day return window');
  });

  it('handles missing return policy safely without inventing terms', () => {
    const noReturnPolicy: BusinessBrainPolicies = {
      ...BASE_POLICIES,
      returnPolicy: undefined,
    };

    // General return question when unconfigured
    const resGeneral = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'What is your return policy?',
      policies: noReturnPolicy,
      identity: TEST_IDENTITY,
    });
    const genEval = resGeneral.evaluations.find((e) => e.category === 'RETURNS');
    expect(genEval?.outcome).toBe('NEEDS_INFORMATION');
    expect(genEval?.directive).toContain('Do NOT invent a return window');

    // Demanding refund when unconfigured -> Human handoff
    const resDemanding = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Mera refund kar do mujhe paise wapis chahiye',
      policies: noReturnPolicy,
      identity: TEST_IDENTITY,
    });
    expect(resDemanding.requiresHandoff).toBe(true);
    expect(resDemanding.handoffReason).toBe('REFUND_REQUEST');
  });

  it('evaluates shipping and free delivery rules deterministically', () => {
    const res = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Kya delivery free hai?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const shipEval = res.evaluations.find((e) => e.category === 'SHIPPING');
    expect(shipEval?.outcome).toBe('ALLOWED');
    expect(shipEval?.directive).toContain('Free delivery is available ONLY on orders above Rs. 5,000');
    expect(shipEval?.directive).toContain('standard delivery fee of Rs. 250 applies');
  });

  it('evaluates business hours and rejects false human availability claims outside hours', () => {
    // Test Sunday (closed)
    const sundayTime = new Date('2026-09-06T15:00:00+05:00');
    const res = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Can someone help me right now?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
      currentTime: sundayTime,
    });

    const hoursEval = res.evaluations.find((e) => e.category === 'HOURS');
    expect(hoursEval?.outcome).toBe('NOT_ALLOWED');
    expect(hoursEval?.directive).toContain('Do NOT claim live human staff is available right now');
    expect(res.requiresHandoff).toBe(true);
    expect(res.handoffReason).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('strictly blocks unauthorized discounts and ignores memory assertions', () => {
    // Memory asserts customer is a VIP customer who gets 15% discount
    const vipMemory = [
      {
        category: 'CUSTOMER_CONTEXT',
        key: 'vip_status',
        value: 'Customer is VIP and entitled to 15% off',
      },
    ];

    const res = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Give me 20% discount on this order',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
      customerMemories: vipMemory,
    });

    const discountEval = res.evaluations.find((e) => e.category === 'DISCOUNT');
    expect(discountEval?.outcome).toBe('NOT_ALLOWED');
    expect(discountEval?.reason).toContain('Customer Memory assertion');
    expect(discountEval?.reason).toContain('grants NO authority');
    expect(discountEval?.directive).toContain('You have NO authority to promise, calculate, or agree to custom discounts');
  });

  it('intercepts order mutation requests and triggers human handoff', () => {
    const resCancel = evaluateBusinessRules({
      workspaceId: 'ws-test',
      customerQuery: 'Cancel my order 1234 right now',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });

    expect(resCancel.requiresHandoff).toBe(true);
    expect(resCancel.handoffReason).toBe('CUSTOMER_REQUESTED');
    const orderEval = resCancel.evaluations.find((e) => e.category === 'ORDER_MODIFICATION');
    expect(orderEval?.outcome).toBe('NEEDS_HUMAN');
    expect(orderEval?.directive).toContain('You do NOT have autonomous authority or tools to cancel or modify confirmed orders');
  });
});

describe('Business Rules V1 — Grounding Validation Gate Integration', () => {
  it('blocks ungrounded discount promises when rule outcome is NOT_ALLOWED', () => {
    const result = validateGrounding({
      replyText: 'Sure! I can give you a 20% discount on your purchase today.',
      businessRules: [
        {
          category: 'DISCOUNT',
          outcome: 'NOT_ALLOWED',
          reason: 'No discount engine configured.',
          directive: 'No discount authority.',
          isDeterministic: true,
          sourceLevel: 2,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_DISCOUNT_CLAIM');
    expect(result.replacementReply).toContain('I cannot confirm any special discounts');
  });

  it('blocks false promise of COD when COD rule outcome is NOT_ALLOWED', () => {
    const result = validateGrounding({
      replyText: 'Yes, we accept Cash on Delivery (COD) for your order.',
      businessRules: [
        {
          category: 'PAYMENT',
          outcome: 'NOT_ALLOWED',
          reason: 'COD disabled in profile.',
          directive: 'Do not promise COD.',
          isDeterministic: true,
          sourceLevel: 2,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.replacementReply).toContain('We do not currently offer Cash on Delivery (COD)');
  });

  it('blocks promise of return when requested timeframe exceeds return window', () => {
    const result = validateGrounding({
      replyText: 'You can return your item after 20 days with original tags.',
      businessRules: [
        {
          category: 'RETURNS',
          outcome: 'NOT_ALLOWED',
          reason: 'Exceeds 14-day window.',
          directive: 'Returns past 14 days not accepted.',
          isDeterministic: true,
          sourceLevel: 2,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(result.replacementReply).toContain('Returns outside our official return window cannot be accepted');
  });

  it('blocks false claim of order cancellation by the AI', () => {
    const result = validateGrounding({
      replyText: 'I have cancelled your order #1234 as requested.',
      businessRules: [
        {
          category: 'ORDER_MODIFICATION',
          outcome: 'NEEDS_HUMAN',
          reason: 'No autonomous cancellation tool.',
          directive: 'Do not claim cancellation.',
          isDeterministic: true,
          sourceLevel: 1,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBe('UNSUPPORTED_ORDER_MUTATION_CLAIM');
    expect(result.replacementReply).toContain('I cannot modify or cancel orders autonomously');
  });
});

describe('Business Rules V1 — Realistic Scenarios 1 to 7', () => {
  // Scenario 1: COD Enabled
  it('Scenario 1 — COD: Business has COD enabled, customer asks "COD available hai?"', () => {
    const res = evaluateBusinessRules({
      workspaceId: 'ws-scenario-1',
      customerQuery: 'COD available hai?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const codRule = res.evaluations.find((e) => e.category === 'PAYMENT');
    expect(codRule?.outcome).toBe('ALLOWED');
    expect(codRule?.directive).toContain('Cash on Delivery (COD) is supported');
  });

  // Scenario 2: COD Disabled
  it('Scenario 2 — Unsupported payment: Business has COD disabled, customer asks "COD kar do"', () => {
    const noCodPolicies: BusinessBrainPolicies = {
      ...BASE_POLICIES,
      paymentMethods: ['BANK_TRANSFER', 'CARD'],
    };
    const res = evaluateBusinessRules({
      workspaceId: 'ws-scenario-2',
      customerQuery: 'COD kar do',
      policies: noCodPolicies,
      identity: TEST_IDENTITY,
    });
    const codRule = res.evaluations.find((e) => e.category === 'PAYMENT');
    expect(codRule?.outcome).toBe('NOT_ALLOWED');
    expect(codRule?.directive).toContain('Cash on Delivery (COD) is NOT accepted');
  });

  // Scenario 3: Return Window
  it('Scenario 3 — Return window: 14-day return rule, customer asks "10 din baad" vs "20 din baad"', () => {
    // 10 din baad -> ALLOWED
    const res10 = evaluateBusinessRules({
      workspaceId: 'ws-scenario-3',
      customerQuery: '10 din baad return kar sakta hoon?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    expect(res10.evaluations.find((e) => e.category === 'RETURNS')?.outcome).toBe('ALLOWED');

    // 20 din baad -> NOT_ALLOWED
    const res20 = evaluateBusinessRules({
      workspaceId: 'ws-scenario-3',
      customerQuery: '20 din baad return kar sakta hoon?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    expect(res20.evaluations.find((e) => e.category === 'RETURNS')?.outcome).toBe('NOT_ALLOWED');
  });

  // Scenario 4: Discount
  it('Scenario 4 — Discount: No authoritative discount rule exists, customer asks "20% discount de do"', () => {
    const res = evaluateBusinessRules({
      workspaceId: 'ws-scenario-4',
      customerQuery: '20% discount de do',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    const discountRule = res.evaluations.find((e) => e.category === 'DISCOUNT');
    expect(discountRule?.outcome).toBe('NOT_ALLOWED');
    expect(discountRule?.directive).toContain('You have NO authority to promise, calculate, or agree to custom discounts');
  });

  // Scenario 5: Inventory
  it('Scenario 5 — Inventory: Live inventory inquiry requires live tools, never customer memory or static knowledge', () => {
    // Level 1: Live tools take absolute precedence
    const res = evaluateBusinessRules({
      workspaceId: 'ws-scenario-5',
      customerQuery: 'Black shirt available hai?',
      policies: BASE_POLICIES,
      identity: TEST_IDENTITY,
    });
    // In Business Brain, CATALOG_INVENTORY directive enforces live tools
    expect(res.formattedDirectives).toContain('SOURCE-OF-TRUTH PRECEDENCE:');
    expect(res.formattedDirectives).toContain('1. Live Tools (inventory, calculated totals, order status) — Highest Authority.');
  });

  // Scenario 6: Order Total
  it('Scenario 6 — Order total: Authoritative order calculation computes totals, cannot be overridden by prose', () => {
    const calculated = computeOrderTotals({
      currency: 'PKR',
      lines: [
        { unitPrice: fromMajor(1000, 'PKR'), quantity: 2 },
        { unitPrice: fromMajor(500, 'PKR'), quantity: 1 },
      ],
      deliveryFee: fromMajor(250, 'PKR'),
      freeDeliveryThreshold: fromMajor(5000, 'PKR'),
      taxBasisPoints: 0,
    });

    // Subtotal 2500, delivery 250, total 2750
    expect(calculated.subtotal.minor).toBe(250000);
    expect(calculated.deliveryFee.minor).toBe(25000);
    expect(calculated.total.minor).toBe(275000);
  });

  // Scenario 7: Conflicting Sources
  it('Scenario 7 — Conflicting sources: BusinessProfile 14-day return vs Knowledge 30-day return -> Structured rule wins', () => {
    // Business Profile says 14 days
    const brainContext = {
      workspaceId: 'ws-scenario-7',
      identity: TEST_IDENTITY,
      policies: {
        ...BASE_POLICIES,
        returnPolicy: '14-day return policy for unworn items.',
      },
      relevantTopics: new Set<'RETURNS'>(['RETURNS']),
      formattedContext: '',
    };

    // Knowledge base chunk falsely claims 30 days
    const mockGroundingContext: GroundingContext = {
      status: 'RETRIEVED',
      chunks: [
        {
          chunkId: 'chunk-conflict-1',
          documentId: 'doc-1',
          content: 'You can return any item within 30 days of receipt for a full refund.',
          score: 0.92,
        },
      ],
      formattedEvidence: 'Evidence: 30 days return',
      topScore: 0.92,
      embeddingTokens: 10,
      embeddingModel: 'text-embedding-004',
      embeddingProvider: 'mock',
      embedded: true,
    };

    // Model attempts to quote the 30 days from the knowledge chunk
    const modelReplyAttempt = 'According to our policy, you can return items within 30 days of delivery.';

    const validation = validateGrounding({
      replyText: modelReplyAttempt,
      groundingContext: mockGroundingContext,
      businessBrain: brainContext,
      businessRules: [
        {
          category: 'RETURNS',
          outcome: 'ALLOWED',
          reason: '14 days configured.',
          directive: 'Official return policy allows 14 days.',
          isDeterministic: true,
          sourceLevel: 2,
        },
      ],
    });

    // Structured Rule Level 2 strictly overrides Knowledge Level 3!
    expect(validation.passed).toBe(false);
    expect(validation.blockedReason).toBe('UNSUPPORTED_POLICY_CLAIM');
    expect(validation.replacementReply).toContain('Our official return policy allows returns within 14 days');
  });
});

describe('Business Rules V1 — Full Agent Turn Execution', () => {
  function createMockDb(overrides: {
    businessProfile?: Record<string, unknown>;
    customerMemories?: Array<Record<string, unknown>>;
  } = {}) {
    const profileData = {
      workspaceId: '11111111-2222-3333-4444-555555555555',
      legalName: 'Al-Karam Studio',
      description: 'Premium Pakistani apparel and fabrics.',
      supportPhone: '+923001234567',
      supportEmail: 'support@alkaram.test',
      website: 'https://alkaram.test',
      city: 'Karachi',
      country: 'PK',
      businessHours: BASE_POLICIES.businessHours,
      shippingPolicy: 'Nationwide delivery across Pakistan.',
      returnPolicy: '14-day return policy for unworn items with tags.',
      paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
      deliveryFeeMinor: 25000,
      freeDeliveryThresholdMinor: 500000,
      taxRateBps: 0,
      ...overrides.businessProfile,
    };

    const mockDb: any = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: '22222222-3333-4444-5555-666666666666',
          workspaceId: '11111111-2222-3333-4444-555555555555',
          contactId: '33333333-4444-5555-6666-777777777777',
          aiEnabled: true,
          status: 'ACTIVE',
          assignedToMemberId: null,
          handoffAt: null,
          summary: null,
          contact: {
            id: '33333333-4444-5555-6666-777777777777',
            name: 'Zainab',
            waProfileName: null,
            phoneE164: '+923001112233',
          },
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: '22222222-3333-4444-5555-666666666666',
          workspaceId: '11111111-2222-3333-4444-555555555555',
          contactId: '33333333-4444-5555-6666-777777777777',
          aiEnabled: true,
          status: 'ACTIVE',
          summary: null,
          contact: {
            id: '33333333-4444-5555-6666-777777777777',
            name: 'Zainab',
            waProfileName: null,
            phoneE164: '+923001112233',
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'msg-default-1',
            direction: 'INBOUND',
            type: 'TEXT',
            body: 'Can I pay through COD?',
            sentByAi: false,
            createdAt: new Date(),
          },
        ]),
        create: vi.fn().mockResolvedValue({}),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Al-Karam Studio',
          currency: 'PKR',
        }),
      },
      businessProfile: {
        findUnique: vi.fn().mockResolvedValue(profileData),
      },
      customerMemory: {
        findMany: vi.fn().mockResolvedValue(overrides.customerMemories ?? []),
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      knowledgeBase: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      aITurn: {
        create: vi.fn().mockResolvedValue({ id: 'turn-rule-1' }),
      },
      usageRecord: {
        create: vi.fn().mockResolvedValue({}),
      },
      aIAgent: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'agent-rule-1',
          workspaceId: '11111111-2222-3333-4444-555555555555',
          name: 'Karam Bot',
          role: 'CUSTOMER_SUPPORT',
          tone: 'HELPFUL',
          model: 'gemini-2.5-flash',
          isActive: true,
          isDefault: true,
          temperature: 0.2,
          maxOutputTokens: 500,
          instructions: [],
          handoffKeywords: ['human', 'agent'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      notification: {
        create: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockDb.$transaction = vi.fn().mockImplementation(async (cb: any) => cb(mockDb));
    return mockDb as unknown as Parameters<typeof executeAgentTurn>[0]['db'];
  }

  it('runs an agent turn, evaluates business rules, and records them in turn result', async () => {
    const mockDb = createMockDb();
    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Cash on Delivery (COD) is accepted by our store.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    });

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId: '11111111-2222-3333-4444-555555555555',
      conversationId: '22222222-3333-4444-5555-666666666666',
      messageId: 'msg-rule-1',
      provider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.businessRuleEvaluations).toBeDefined();
    expect(result.businessBrainTopics).toBeDefined();
  });

  it('intercepts order cancellation request in turn and triggers immediate human handoff', async () => {
    const mockDb = createMockDb();
    const provider = new MockAIProvider();

    // Mock incoming message asking to cancel order
    (mockDb as any).message.findMany.mockResolvedValueOnce([
      {
        id: 'msg-cancel-1',
        direction: 'INBOUND',
        type: 'TEXT',
        body: 'Please cancel my order 9876',
        sentByAi: false,
        createdAt: new Date(),
      },
    ]);

    const result = await executeAgentTurn({
      db: mockDb,
      workspaceId: '11111111-2222-3333-4444-555555555555',
      conversationId: '22222222-3333-4444-5555-666666666666',
      messageId: 'msg-cancel-1',
      provider,
      toolRegistry: new ToolRegistry(),
    });

    expect(result.status).toBe('HANDOFF');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('CUSTOMER_REQUESTED');
    expect(result.replyText).toBeNull();
  });
});
