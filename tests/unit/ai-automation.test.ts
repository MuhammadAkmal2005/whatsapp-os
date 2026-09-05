/**
 * Unit Tests for AI Automation V1 (Phase 20 & Phase 21 Scenarios 1 to 8).
 *
 * Validates the 5-level action authority model, validated tool chaining, business rules gates,
 * authoritative server totals, idempotency duplicate prevention, grounding result trust,
 * safe customer contact updates, and tenant boundary enforcement.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { createAITenantContext } from '@/server/services/agent/context';
import { createOrderTool } from '@/server/services/agent/tools/impl/create-order.tool';
import { updateCustomerDetailsTool } from '@/server/services/agent/tools/impl/update-customer-details.tool';
import { defaultToolRegistry, ToolRegistry } from '@/server/services/agent/tools/registry';
import { validateGrounding } from '@/server/services/agent/grounding.service';
import { evaluateBusinessRules } from '@/server/services/agent/business-rules.service';
import type { BusinessBrainPolicies, BusinessBrainIdentity } from '@/server/services/agent/business-brain.service';

vi.mock('@/db/prisma', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    businessProfile: {
      findUnique: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    inventoryItem: {
      findFirst: vi.fn(),
    },
    orderItem: {
      findMany: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
  isUniqueConstraintViolation: vi.fn(() => false),
}));

vi.mock('@/server/repositories/conversation.repository', () => ({
  findConversationById: vi.fn(),
}));

vi.mock('@/server/repositories/contact.repository', () => ({
  findContactById: vi.fn(),
  updateContact: vi.fn(),
}));

vi.mock('@/server/repositories/inventory.repository', () => ({
  findStock: vi.fn(),
  reserveStock: vi.fn(),
}));

vi.mock('@/server/repositories/workspace.repository', () => ({
  findBusinessMoneySettings: vi.fn(),
}));

vi.mock('@/server/repositories/order.repository', () => ({
  generateOrderNumber: vi.fn(() => Promise.resolve('CN-2609-0010')),
  createOrder: vi.fn(),
  createOrderEvent: vi.fn(),
}));

import { findConversationById } from '@/server/repositories/conversation.repository';
import { findContactById, updateContact } from '@/server/repositories/contact.repository';
import { findStock, reserveStock } from '@/server/repositories/inventory.repository';
import { findBusinessMoneySettings } from '@/server/repositories/workspace.repository';
import { createOrder as createOrderRow } from '@/server/repositories/order.repository';

const TEST_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const TEST_AGENT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_CONVERSATION_ID = '33333333-3333-3333-3333-333333333333';
const TEST_MESSAGE_ID = '44444444-4444-4444-4444-444444444444';
const TEST_CONTACT_ID = '55555555-5555-5555-5555-555555555555';
const TEST_PRODUCT_ID = '66666666-6666-6666-6666-666666666666';

const BASE_POLICIES: BusinessBrainPolicies = {
  paymentMethods: ['CASH_ON_DELIVERY', 'BANK_TRANSFER'],
  returnPolicy: '14-day return policy for unused items with original tags.',
  shippingPolicy: 'Standard delivery in 2-3 business days across Pakistan.',
  deliveryFeeMinor: 25000,
  deliveryFeeDisplay: 'Rs. 250',
  freeDeliveryThresholdMinor: 500000,
  freeDeliveryThresholdDisplay: 'Rs. 5,000',
  taxRateBps: 0,
  taxRateDisplay: '0%',
  businessHours: null,
};

const BASE_IDENTITY: BusinessBrainIdentity = {
  businessName: 'Silk & Cotton Studio',
  country: 'PK',
  currency: 'PKR',
};

describe('AI Automation V1 — Tool Contracts & Registration', () => {
  it('registers create_order and update_customer_details in default registry', () => {
    expect(defaultToolRegistry.has('create_order')).toBe(true);
    expect(defaultToolRegistry.has('update_customer_details')).toBe(true);

    const orderTool = defaultToolRegistry.get('create_order');
    expect(orderTool?.classification).toBe('WRITE');
    expect(orderTool?.capabilityRequired).toBe('orders:create');
    expect(orderTool?.auditRequired).toBe(true);

    const customerTool = defaultToolRegistry.get('update_customer_details');
    expect(customerTool?.classification).toBe('WRITE');
    expect(customerTool?.capabilityRequired).toBe('contacts:update');
    expect(customerTool?.auditRequired).toBe(true);
  });

  it('filters tool definitions strictly by server-verified capabilities', () => {
    const registry = new ToolRegistry();
    registry.register(createOrderTool);
    registry.register(updateCustomerDetailsTool);

    // Context without orders:create
    const defsNoOrder = registry.getDefinitionsForCapabilities(new Set(['contacts:update']));
    expect(defsNoOrder.map((d) => d.name)).toEqual(['update_customer_details']);

    // Context with orders:create
    const defsWithOrder = registry.getDefinitionsForCapabilities(new Set(['orders:create', 'contacts:update']));
    expect(defsWithOrder.map((d) => d.name)).toEqual(['create_order', 'update_customer_details']);
  });

  it('validates create_order input schema strictly (Zod boundary)', () => {
    // Valid input
    const valid = createOrderTool.inputSchema.parse({
      items: [{ productId: TEST_PRODUCT_ID, quantity: 2 }],
      paymentMethod: 'COD',
      addressLine1: 'House 12, Street 3, F-7/2',
      city: 'Islamabad',
    });
    expect(valid.items).toHaveLength(1);
    expect(valid.paymentMethod).toBe('COD');

    // Invalid: non-UUID product
    expect(() =>
      createOrderTool.inputSchema.parse({
        items: [{ productId: 'invalid-id', quantity: 1 }],
      }),
    ).toThrow();

    // Invalid: quantity < 1
    expect(() =>
      createOrderTool.inputSchema.parse({
        items: [{ productId: TEST_PRODUCT_ID, quantity: 0 }],
      }),
    ).toThrow();

    // Invalid: empty items array
    expect(() =>
      createOrderTool.inputSchema.parse({
        items: [],
      }),
    ).toThrow();

    // Rejects model-injected totals or discounts (schema does not accept them)
    const injected = createOrderTool.inputSchema.parse({
      items: [{ productId: TEST_PRODUCT_ID, quantity: 1 }],
      discountMinor: 50000,
      totalMinor: 100,
    } as any);
    expect(injected).not.toHaveProperty('discountMinor');
    expect(injected).not.toHaveProperty('totalMinor');
  });

  it('validates update_customer_details input schema strictly', () => {
    const valid = updateCustomerDetailsTool.inputSchema.parse({
      name: 'Muhammad Ali',
      addressLine1: 'Flat 4B, Clifton',
      city: 'Karachi',
      postalCode: '75600',
    });
    expect(valid.name).toBe('Muhammad Ali');
    expect(valid.city).toBe('Karachi');

    // Empty string rejected by min(1)
    expect(() =>
      updateCustomerDetailsTool.inputSchema.parse({
        name: '',
      }),
    ).toThrow();
  });
});

describe('AI Automation V1 — Realistic Scenarios 1 to 8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Successful Order Flow
  // Customer: "Black shirt medium wali order kar do."
  // ---------------------------------------------------------------------------
  it('Scenario 1 — Successful order: resolves product, checks stock, server-prices totals, creates order', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      capabilities: ['orders:create', 'contacts:update'],
    });

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null); // No existing order
    vi.mocked(findConversationById).mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      contactId: TEST_CONTACT_ID,
      status: 'OPEN',
      channel: 'WHATSAPP',
    } as any);

    vi.mocked(prisma.workspace.findUnique).mockResolvedValueOnce({
      id: TEST_WORKSPACE_ID,
      name: 'Silk & Cotton Studio',
      currency: 'PKR',
    } as any);

    vi.mocked(prisma.businessProfile.findUnique).mockResolvedValueOnce({
      workspaceId: TEST_WORKSPACE_ID,
      paymentMethods: ['COD', 'BANK_TRANSFER'],
    } as any);

    vi.mocked(findContactById).mockResolvedValue({
      id: TEST_CONTACT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      phoneE164: '+923001234567',
      name: 'Akmal Khan',
      addressLine1: 'House 14, St 2',
      city: 'Lahore',
      totalOrders: 1,
      totalSpentMinor: 250000,
    } as any);

    // Mock Product in DB
    const mockProduct = {
      id: TEST_PRODUCT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      name: 'Black Silk Shirt',
      sku: 'BSS-001',
      priceMinor: 350000,
      salePriceMinor: null,
      currency: 'PKR',
      trackInventory: true,
      variants: [
        {
          id: '77777777-7777-7777-7777-777777777777',
          sku: 'BSS-001-M',
          name: 'Medium',
          size: 'M',
          color: 'Black',
          priceMinor: null,
          salePriceMinor: null,
        },
      ],
    };

    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct as any]);

    // Mock Inventory in stock
    vi.mocked(findStock).mockResolvedValue({
      id: 'inv-1',
      workspaceId: TEST_WORKSPACE_ID,
      productId: TEST_PRODUCT_ID,
      variantId: '77777777-7777-7777-7777-777777777777',
      available: 5,
      reserved: 0,
      sold: 0,
      lowStockThreshold: 2,
      updatedAt: new Date(),
    });

    vi.mocked(findBusinessMoneySettings).mockResolvedValueOnce({
      deliveryFeeMinor: 25000,
      freeDeliveryThresholdMinor: 500000,
      taxRateBps: 0,
    });

    vi.mocked(createOrderRow).mockResolvedValueOnce({
      id: 'ord-123',
      workspaceId: TEST_WORKSPACE_ID,
      orderNumber: 'CN-2609-0010',
      contactId: TEST_CONTACT_ID,
      conversationId: TEST_CONVERSATION_ID,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'UNFULFILLED',
      currency: 'PKR',
      subtotalMinor: 350000,
      discountMinor: 0,
      deliveryFeeMinor: 25000,
      taxMinor: 0,
      totalMinor: 375000,
      paymentMethod: 'COD',
      customerName: 'Akmal Khan',
      phoneE164: '+923001234567',
      addressLine1: 'House 14, St 2',
      city: 'Lahore',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await createOrderTool.handler(ctx, {
      items: [
        {
          productId: TEST_PRODUCT_ID,
          variantId: '77777777-7777-7777-7777-777777777777',
          quantity: 1,
        },
      ],
      paymentMethod: 'COD',
    });

    expect('success' in result).toBe(true);
    if ('success' in result) {
      expect(result.orderNumber).toBe('CN-2609-0010');
      expect(result.currency).toBe('PKR');
      expect(result.subtotalMinor).toBe(350000);
      expect(result.deliveryFeeMinor).toBe(25000);
      expect(result.totalMinor).toBe(375000);
      expect(result.totalDisplay).toBe('Rs. 3,750');
      expect(result.message).toContain("Order placed successfully. The amounts below are the server's own figures");
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Ambiguous Product
  // Customer: "Black shirt order kar do." (Multiple exist, clarify before acting)
  // ---------------------------------------------------------------------------
  it('Scenario 2 — Ambiguous product: business rules mandate live tool search & clarification without ordering', () => {
    const res = evaluateBusinessRules({
      workspaceId: TEST_WORKSPACE_ID,
      customerQuery: 'Black shirt order kar do',
      policies: BASE_POLICIES,
      identity: BASE_IDENTITY,
    });

    const catalogRule = res.evaluations.find((e) => e.category === 'CATALOG_INVENTORY');
    expect(catalogRule?.outcome).toBe('ALLOWED');
    expect(catalogRule?.directive).toContain('MUST use the search_products, check_inventory, or get_product tools');

    // Model must NOT invent a product ID to call create_order
    expect(() => {
      createOrderTool.inputSchema.parse({
        items: [{ productId: 'non-uuid-guess', quantity: 1 }],
      });
    }).toThrow();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Out of Stock
  // Product has 0 stock available -> Tool rejects order with INSUFFICIENT_STOCK
  // ---------------------------------------------------------------------------
  it('Scenario 3 — Out of stock: check_inventory rejects order and reports actual availability', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      capabilities: ['orders:create'],
    });

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);
    vi.mocked(findConversationById).mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      contactId: TEST_CONTACT_ID,
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValueOnce({
      id: TEST_WORKSPACE_ID,
      name: 'Silk & Cotton Studio',
      currency: 'PKR',
    } as any);
    vi.mocked(prisma.businessProfile.findUnique).mockResolvedValueOnce({
      workspaceId: TEST_WORKSPACE_ID,
      paymentMethods: ['COD'],
    } as any);
    vi.mocked(findContactById).mockResolvedValueOnce({
      id: TEST_CONTACT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    } as any);

    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      {
        id: TEST_PRODUCT_ID,
        workspaceId: TEST_WORKSPACE_ID,
        name: 'Chiffon Dupatta',
        trackInventory: true,
        variants: [],
      } as any,
    ]);

    // Live inventory: 0 available
    vi.mocked(findStock).mockResolvedValueOnce({
      id: 'inv-out',
      workspaceId: TEST_WORKSPACE_ID,
      productId: TEST_PRODUCT_ID,
      variantId: null,
      available: 0,
      reserved: 0,
      sold: 10,
      lowStockThreshold: 2,
      updatedAt: new Date(),
    });

    const result = await createOrderTool.handler(ctx, {
      items: [{ productId: TEST_PRODUCT_ID, quantity: 1 }],
      paymentMethod: 'COD',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('INSUFFICIENT_STOCK');
      expect(result.message).toContain('Insufficient stock for "Chiffon Dupatta"');
      expect(result.message).toContain('Available: 0');
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Unauthorized Discount
  // Customer: "20% discount laga ke order kar do."
  // ---------------------------------------------------------------------------
  it('Scenario 4 — Unauthorized discount: business rule strictly denies discount authority', () => {
    const res = evaluateBusinessRules({
      workspaceId: TEST_WORKSPACE_ID,
      customerQuery: '20% discount laga ke order kar do',
      policies: BASE_POLICIES,
      identity: BASE_IDENTITY,
    });

    const discountRule = res.evaluations.find((e) => e.category === 'DISCOUNT');
    expect(discountRule?.outcome).toBe('NOT_ALLOWED');
    expect(discountRule?.directive).toContain('You have NO authority to promise, calculate, or agree to custom discounts');

    // Grounding gate intercepts any assistant attempt to promise 20% discount
    const groundingCheck = validateGrounding({
      replyText: 'I have applied a 20% discount to your order as requested.',
      businessRules: res.evaluations,
    });

    expect(groundingCheck.passed).toBe(false);
    expect(groundingCheck.blockedReason).toBe('UNSUPPORTED_DISCOUNT_CLAIM');
    expect(groundingCheck.replacementReply).toContain('I cannot confirm any special discounts or promotional pricing');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Payment Method Unsupported
  // Store has disabled COD (only BANK_TRANSFER accepted) -> COD is rejected
  // ---------------------------------------------------------------------------
  it('Scenario 5 — Unsupported payment method: create_order rejects unaccepted payment method by rule', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      capabilities: ['orders:create'],
    });

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);
    vi.mocked(findConversationById).mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      contactId: TEST_CONTACT_ID,
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValueOnce({
      id: TEST_WORKSPACE_ID,
      name: 'Silk & Cotton Studio',
      currency: 'PKR',
    } as any);

    // Business only accepts BANK_TRANSFER
    vi.mocked(prisma.businessProfile.findUnique).mockResolvedValueOnce({
      workspaceId: TEST_WORKSPACE_ID,
      paymentMethods: ['BANK_TRANSFER'],
    } as any);

    vi.mocked(findContactById).mockResolvedValueOnce({
      id: TEST_CONTACT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    } as any);

    const result = await createOrderTool.handler(ctx, {
      items: [{ productId: TEST_PRODUCT_ID, quantity: 1 }],
      paymentMethod: 'COD', // Requested COD when business only takes BANK_TRANSFER
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('REJECTED_BY_RULE');
      expect(result.reason).toBe('PAYMENT_METHOD_NOT_SUPPORTED');
      expect(result.message).toContain('Payment method COD is not accepted by this business');
      expect(result.message).toContain('Bank Transfer');
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Duplicate Tool Call / Idempotency
  // Repeated call with same messageId/executionId returns existing order
  // ---------------------------------------------------------------------------
  it('Scenario 6 — Duplicate tool call: returns existing order without creating duplicate', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      executionId: 'exec-dup-1',
      capabilities: ['orders:create'],
    });

    // Existing order row already persisted for this idempotency key
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord-existing-1',
      workspaceId: TEST_WORKSPACE_ID,
      orderNumber: 'CN-2609-0005',
      status: 'PENDING',
      currency: 'PKR',
      subtotalMinor: 200000,
      discountMinor: 0,
      deliveryFeeMinor: 25000,
      taxMinor: 0,
      totalMinor: 225000,
    } as any);

    const result = await createOrderTool.handler(ctx, {
      items: [{ productId: TEST_PRODUCT_ID, quantity: 1 }],
      paymentMethod: 'COD',
    });

    expect('success' in result).toBe(true);
    if ('success' in result) {
      expect(result.orderNumber).toBe('CN-2609-0005');
      expect(result.message).toContain('Order already created for this request (idempotent return)');
      expect(result.totalMinor).toBe(225000);
      expect(result.totalDisplay).toBe('Rs. 2,250');
    }

    // createOrder was NEVER called again
    expect(createOrderRow).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Tool Result Trust
  // When tool fails, assistant must NOT say "Order ho gaya"
  // ---------------------------------------------------------------------------
  it('Scenario 7 — Tool result honesty: grounding gate blocks fake success message when tool failed', () => {
    // create_order failed due to insufficient stock
    const failedToolCalls = [
      {
        name: 'create_order',
        isError: true,
        result: {
          success: false,
          error: 'INSUFFICIENT_STOCK',
          message: 'Insufficient stock for "Silk Kurta". Available: 0, requested: 1.',
        },
      },
    ];

    // Model hallucinates success anyway
    const fakeSuccessReply = 'Aap ka order confirm ho gaya hai! Order #CN-1234 book ho chuka hai.';

    const validation = validateGrounding({
      replyText: fakeSuccessReply,
      toolCalls: failedToolCalls,
    });

    expect(validation.passed).toBe(false);
    expect(validation.blockedReason).toBe('FALSE_ORDER_CONFIRMATION_CLAIM');
    expect(validation.replacementReply).toContain('I was unable to place your order');
    expect(validation.replacementReply).toContain('Insufficient stock for "Silk Kurta"');
  });

  it('Scenario 7b — Tool result honesty: grounding gate blocks fake order confirmation when create_order was never called', () => {
    // Model claims order was placed without ever calling create_order
    const validation = validateGrounding({
      replyText: 'Your order has been placed successfully! We will deliver it in 2 days.',
      toolCalls: [
        {
          name: 'search_products',
          result: { products: [] },
        },
      ],
    });

    expect(validation.passed).toBe(false);
    expect(validation.blockedReason).toBe('FALSE_ORDER_CONFIRMATION_CLAIM');
    expect(validation.replacementReply).toContain('I was unable to place your order because the required details could not be verified');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Customer Memory Contextualization
  // Memory has size "Medium", but live inventory and pricing come from live tools
  // ---------------------------------------------------------------------------
  it('Scenario 8 — Customer memory: contextualizes size preference but live inventory and prices come from tools', () => {
    const memory = [
      {
        category: 'PREFERENCE',
        key: 'preferred_size',
        value: 'Customer previously ordered Medium in shirts',
      },
    ];

    const res = evaluateBusinessRules({
      workspaceId: TEST_WORKSPACE_ID,
      customerQuery: 'Wohi size rakhna aur order kar do',
      policies: BASE_POLICIES,
      identity: BASE_IDENTITY,
      customerMemories: memory,
    });

    // Level 1 Mandate on catalog/inventory remains in force
    const catalogRule = res.evaluations.find((e) => e.category === 'CATALOG_INVENTORY');
    expect(catalogRule?.directive).toContain('LIVE DATA MANDATE: For product stock, sizing, variants, or prices, you MUST use the search_products, check_inventory, or get_product tools');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Safe Customer Contact Update Tool
  // ---------------------------------------------------------------------------
  it('Scenario 9 — Safe customer details update: updates delivery address and contact name within tenant boundary', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      capabilities: ['contacts:update'],
    });

    vi.mocked(findConversationById).mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      contactId: TEST_CONTACT_ID,
    } as any);

    vi.mocked(findContactById).mockResolvedValueOnce({
      id: TEST_CONTACT_ID,
      workspaceId: TEST_WORKSPACE_ID,
      name: null,
      addressLine1: null,
    } as any);

    vi.mocked(updateContact).mockResolvedValueOnce(1);

    const result = await updateCustomerDetailsTool.handler(ctx, {
      name: 'Fatima Zahra',
      addressLine1: 'House 5, Street 8, Sector F-6',
      city: 'Islamabad',
      postalCode: '44000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.contactId).toBe(TEST_CONTACT_ID);
      expect(result.updatedFields.name).toBe('Fatima Zahra');
      expect(result.updatedFields.city).toBe('Islamabad');
    }

    expect(updateContact).toHaveBeenCalledWith(
      prisma,
      TEST_WORKSPACE_ID,
      TEST_CONTACT_ID,
      expect.objectContaining({
        name: 'Fatima Zahra',
        addressLine1: 'House 5, Street 8, Sector F-6',
        city: 'Islamabad',
        postalCode: '44000',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Tenant Boundary Enforcement
  // ---------------------------------------------------------------------------
  it('Scenario 10 — Tenant isolation: cross-tenant product lookup is blocked', async () => {
    const ctx = createAITenantContext({
      workspaceId: TEST_WORKSPACE_ID,
      agentId: TEST_AGENT_ID,
      conversationId: TEST_CONVERSATION_ID,
      messageId: TEST_MESSAGE_ID,
      capabilities: ['orders:create'],
    });

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);
    vi.mocked(findConversationById).mockResolvedValueOnce({
      id: TEST_CONVERSATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      contactId: TEST_CONTACT_ID,
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValueOnce({
      id: TEST_WORKSPACE_ID,
      name: 'Silk & Cotton Studio',
      currency: 'PKR',
    } as any);
    vi.mocked(prisma.businessProfile.findUnique).mockResolvedValueOnce({
      workspaceId: TEST_WORKSPACE_ID,
      paymentMethods: ['COD'],
    } as any);
    vi.mocked(findContactById).mockResolvedValueOnce({
      id: TEST_CONTACT_ID,
      workspaceId: TEST_WORKSPACE_ID,
    } as any);

    // Product belongs to competitor workspace, findMany returns empty for TEST_WORKSPACE_ID
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);

    const result = await createOrderTool.handler(ctx, {
      items: [{ productId: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
      paymentMethod: 'COD',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('PRODUCT_NOT_FOUND');
    }
  });
});
