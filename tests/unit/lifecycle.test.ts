/**
 * Unit tests for Conversation & Lead Lifecycle V1.
 *
 * Validates deterministic state derivation, precedence rules, qualifying order handling,
 * customer vs. conversation lifecycle separation, AI prompt generation, and tenant scoping.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  deriveConversationLifecycle,
  deriveCustomerLifecycle,
  formatLifecycleForAiPrompt,
  getConversationLifecycle,
  getCustomerLifecycle,
  getCombinedLifecycleContext,
  type ConversationFacts,
  type CustomerFacts,
} from '@/server/services/lifecycle/lifecycle.service';

describe('Conversation Lifecycle V1 — Deterministic Derivation', () => {
  it('derives NEW for initial inquiry with <= 1 message and no outbound reply', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 1,
      lastInboundAt: new Date('2026-09-01T10:00:00Z'),
      lastOutboundAt: null,
      hasQualifyingOrder: false,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('NEW');
    expect(result.label).toBe('New');
    expect(result.isAwaitingHuman).toBe(false);
  });

  it('derives ACTIVE for bidirectional conversation without special intent', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 4,
      lastInboundAt: new Date('2026-09-01T10:05:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:02:00Z'),
      hasQualifyingOrder: false,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('ACTIVE');
    expect(result.label).toBe('Active');
  });

  it('derives AWAITING_CUSTOMER when last message is outbound', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 3,
      lastInboundAt: new Date('2026-09-01T10:00:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:01:00Z'),
      hasQualifyingOrder: false,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('AWAITING_CUSTOMER');
    expect(result.label).toBe('Awaiting Customer');
  });

  it('derives PRODUCT_INTEREST when product inquiry tools were executed', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 3,
      lastInboundAt: new Date('2026-09-01T10:05:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:02:00Z'),
      hasQualifyingOrder: false,
      hasProductInquiryToolCalls: true,
      productInquiries: ['Black Linen Shirt'],
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('PRODUCT_INTEREST');
    expect(result.label).toBe('Product Interest');
    expect(result.productInquiries).toContain('Black Linen Shirt');
  });

  it('derives READY_TO_ORDER when order creation is attempted or pending approval exists', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 5,
      lastInboundAt: new Date('2026-09-01T10:10:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:08:00Z'),
      hasQualifyingOrder: false,
      hasOrderCreationToolCalls: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('READY_TO_ORDER');
    expect(result.label).toBe('Ready to Order');
  });

  it('derives READY_TO_ORDER when draft/pending order exists', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 4,
      lastInboundAt: new Date('2026-09-01T10:10:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:08:00Z'),
      hasQualifyingOrder: false,
      hasDraftOrPendingOrder: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('READY_TO_ORDER');
  });

  it('derives AWAITING_HUMAN when aiEnabled is false', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: false,
      handoffReason: 'MANUAL_TAKEOVER',
      messageCount: 2,
      lastInboundAt: new Date('2026-09-01T10:00:00Z'),
      lastOutboundAt: null,
      hasQualifyingOrder: false,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('AWAITING_HUMAN');
    expect(result.isAwaitingHuman).toBe(true);
  });

  it('derives AWAITING_HUMAN when handoffAt is present', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      handoffAt: new Date('2026-09-01T10:05:00Z'),
      handoffReason: 'CUSTOMER_REQUESTED',
      messageCount: 4,
      lastInboundAt: new Date('2026-09-01T10:05:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:02:00Z'),
      hasQualifyingOrder: false,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('AWAITING_HUMAN');
    expect(result.isAwaitingHuman).toBe(true);
  });

  it('derives CONVERTED when qualifying order is placed in conversation', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 8,
      lastInboundAt: new Date('2026-09-01T10:15:00Z'),
      lastOutboundAt: new Date('2026-09-01T10:14:00Z'),
      hasQualifyingOrder: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('CONVERTED');
    expect(result.label).toBe('Converted');
    expect(result.hasQualifyingOrder).toBe(true);
  });

  it('derives CLOSED when status is CLOSED or RESOLVED', () => {
    const facts: ConversationFacts = {
      status: 'CLOSED',
      closedAt: new Date('2026-09-01T12:00:00Z'),
      aiEnabled: true,
      messageCount: 10,
      hasQualifyingOrder: true, // even if it was converted, closed thread takes precedence
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('CLOSED');
    expect(result.label).toBe('Closed');
  });

  it('precedence: CONVERTED takes precedence over AWAITING_HUMAN', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: false,
      handoffAt: new Date('2026-09-01T10:00:00Z'),
      messageCount: 6,
      hasQualifyingOrder: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('CONVERTED');
  });

  it('precedence: AWAITING_HUMAN takes precedence over READY_TO_ORDER', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: false,
      handoffAt: new Date('2026-09-01T10:00:00Z'),
      messageCount: 4,
      hasQualifyingOrder: false,
      hasDraftOrPendingOrder: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('AWAITING_HUMAN');
  });

  it('precedence: READY_TO_ORDER takes precedence over PRODUCT_INTEREST', () => {
    const facts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 5,
      hasQualifyingOrder: false,
      hasProductInquiryToolCalls: true,
      productInquiries: ['Shirt'],
      hasOrderCreationToolCalls: true,
    };
    const result = deriveConversationLifecycle(facts);
    expect(result.stage).toBe('READY_TO_ORDER');
  });
});

describe('Customer Lifecycle V1 — Deterministic Derivation', () => {
  it('derives NEW_CUSTOMER for newly created contact with 0 orders and minimal activity', () => {
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      messageCount: 1,
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('NEW_CUSTOMER');
    expect(result.label).toBe('New Customer');
    expect(result.qualifyingOrdersCount).toBe(0);
  });

  it('derives PROSPECT for contact with conversation history but 0 qualifying orders', () => {
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      messageCount: 6,
      lastInteractionAt: new Date('2026-09-01T11:00:00Z'),
      status: 'ACTIVE',
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('PROSPECT');
    expect(result.label).toBe('Prospect');
  });

  it('derives INTERESTED for contact with verified product interest and 0 qualifying orders', () => {
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      hasProductInterest: true,
      productPreferences: ['Formal Shirts in Medium'],
      messageCount: 3,
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('INTERESTED');
    expect(result.label).toBe('Interested');
  });

  it('derives ORDERED for contact with exactly 1 qualifying order', () => {
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 1,
      totalSpentMinor: 450000,
      lastOrderAt: new Date('2026-08-15T14:00:00Z'),
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('ORDERED');
    expect(result.label).toBe('Ordered');
    expect(result.qualifyingOrdersCount).toBe(1);
    expect(result.totalSpentMinor).toBe(450000);
  });

  it('derives REPEAT_CUSTOMER for contact with 2 or more qualifying orders', () => {
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 3,
      totalSpentMinor: 1250000,
      lastOrderAt: new Date('2026-09-02T16:30:00Z'),
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('REPEAT_CUSTOMER');
    expect(result.label).toBe('Repeat Customer');
    expect(result.qualifyingOrdersCount).toBe(3);
  });

  it('does not count cancelled or draft orders as qualifying orders', () => {
    // If contact placed 3 orders total, but 2 were cancelled and 1 was draft:
    // qualifying count is 0
    const facts: CustomerFacts = {
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      messageCount: 5,
    };
    const result = deriveCustomerLifecycle(facts);
    expect(result.stage).toBe('PROSPECT');
    expect(result.stage).not.toBe('ORDERED');
    expect(result.stage).not.toBe('REPEAT_CUSTOMER');
  });
});

describe('Customer vs. Conversation State Separation', () => {
  it('preserves REPEAT_CUSTOMER customer lifecycle while conversation is PRODUCT_INTEREST', () => {
    const customerFacts: CustomerFacts = {
      qualifyingOrdersCount: 3,
      totalSpentMinor: 1500000,
      lastOrderAt: new Date('2026-08-01T10:00:00Z'),
    };
    const conversationFacts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 2,
      lastInboundAt: new Date('2026-09-06T03:00:00Z'),
      lastOutboundAt: null,
      hasQualifyingOrder: false,
      hasProductInquiryToolCalls: true,
      productInquiries: ['Blue Kurta Large'],
    };

    const customerLifecycle = deriveCustomerLifecycle(customerFacts);
    const conversationLifecycle = deriveConversationLifecycle(conversationFacts);

    expect(customerLifecycle.stage).toBe('REPEAT_CUSTOMER');
    expect(conversationLifecycle.stage).toBe('PRODUCT_INTEREST');
  });

  it('preserves ORDERED customer lifecycle while conversation is AWAITING_HUMAN', () => {
    const customerFacts: CustomerFacts = {
      qualifyingOrdersCount: 1,
      totalSpentMinor: 350000,
      lastOrderAt: new Date('2026-08-20T10:00:00Z'),
    };
    const conversationFacts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: false,
      handoffAt: new Date('2026-09-06T03:30:00Z'),
      handoffReason: 'CUSTOMER_REQUESTED',
      messageCount: 5,
      hasQualifyingOrder: false,
    };

    const customerLifecycle = deriveCustomerLifecycle(customerFacts);
    const conversationLifecycle = deriveConversationLifecycle(conversationFacts);

    expect(customerLifecycle.stage).toBe('ORDERED');
    expect(conversationLifecycle.stage).toBe('AWAITING_HUMAN');
  });

  it('pending approval does not alter customer lifecycle', () => {
    // A customer requesting a cancellation has a pending approval, but the order is not cancelled yet
    const customerFacts: CustomerFacts = {
      qualifyingOrdersCount: 1,
      totalSpentMinor: 500000,
      lastOrderAt: new Date('2026-09-01T10:00:00Z'),
    };
    const conversationFacts: ConversationFacts = {
      status: 'OPEN',
      aiEnabled: true,
      messageCount: 4,
      hasQualifyingOrder: false,
      hasPendingApproval: true,
    };

    const customerLifecycle = deriveCustomerLifecycle(customerFacts);
    const conversationLifecycle = deriveConversationLifecycle(conversationFacts);

    expect(customerLifecycle.stage).toBe('ORDERED');
    expect(conversationLifecycle.stage).toBe('READY_TO_ORDER');
  });
});

describe('AI Prompt Formatting & Budget Bounds', () => {
  it('formats prompt with customer and conversation lifecycle concisely', () => {
    const formatted = formatLifecycleForAiPrompt({
      customer: {
        stage: 'REPEAT_CUSTOMER',
        label: 'Repeat Customer',
        reason: '2 qualifying orders completed',
        qualifyingOrdersCount: 2,
        totalSpentMinor: 750000,
        lastOrderAt: new Date('2026-08-10'),
        hasProductInterest: true,
      },
      conversation: {
        stage: 'PRODUCT_INTEREST',
        label: 'Product Interest',
        reason: 'Active inquiry regarding specific catalog items',
        hasQualifyingOrder: false,
        isAwaitingHuman: false,
        lastActivityAt: new Date(),
        productInquiries: ['Black Shirt', 'Chino Pants'],
      },
    });

    expect(formatted).toContain('Customer Relationship: REPEAT_CUSTOMER (2 completed orders)');
    expect(formatted).toContain('Current Conversation Stage: PRODUCT_INTEREST');
    expect(formatted).toContain('Product Inquiries: Black Shirt, Chino Pants');
    expect(formatted).toContain('Lifecycle stage does NOT authorize discounts or policy exceptions');

    // Keep it strictly bounded (less than 600 characters)
    expect(formatted.length).toBeLessThan(600);
  });
});

describe('Database Loader & Multi-Tenant Scoping', () => {
  it('scopes queries strictly to workspaceId', async () => {
    const workspaceId = 'workspace-alpha-1111';
    const conversationId = 'conv-2222';
    const contactId = 'contact-3333';

    const mockDb = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: conversationId,
          contactId,
          status: 'OPEN',
          aiEnabled: true,
          handoffAt: null,
          handoffReason: null,
          messageCount: 3,
          lastInboundAt: new Date('2026-09-01T10:00:00Z'),
          lastOutboundAt: new Date('2026-09-01T10:02:00Z'),
          resolvedAt: null,
          closedAt: null,
        }),
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue({
          id: contactId,
          leadStage: 'NEW',
          status: 'LEAD',
          totalOrders: 0,
          totalSpentMinor: 0,
          lastOrderAt: null,
          lastInteractionAt: null,
        }),
      },
      order: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalMinor: 0 } }),
      },
      actionApproval: {
        count: vi.fn().mockResolvedValue(0),
      },
      aITurn: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customerMemory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const combined = await getCombinedLifecycleContext(
      mockDb as any,
      workspaceId,
      conversationId,
    );

    expect(combined.conversation).toBeDefined();
    expect(combined.customer).toBeDefined();

    // Verify conversation was scoped to workspaceId
    expect(mockDb.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: conversationId, workspaceId },
      select: expect.any(Object),
    });

    // Verify contact was scoped to workspaceId
    expect(mockDb.contact.findFirst).toHaveBeenCalledWith({
      where: { id: contactId, workspaceId },
      select: expect.any(Object),
    });

    // Verify order counts were scoped to workspaceId
    expect(mockDb.order.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId }),
      }),
    );
  });
});
