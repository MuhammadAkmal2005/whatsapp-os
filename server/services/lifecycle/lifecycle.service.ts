/**
 * ConvoNexa Conversation & Lead Lifecycle Service V1.
 *
 * Provides deterministic, multi-tenant customer journey and conversation lifecycle state
 * derivation based on authoritative domain facts (Orders, Conversations, Messages, Statuses,
 * AI tool executions, and Customer Memory).
 *
 * Source of Truth Hierarchy:
 * - Level 1: Domain facts (authoritative orders, payments, conversations, timestamps)
 * - Level 2: Verified AI tool execution (search_products, check_inventory, create_order, handoffs)
 * - Level 3: Customer Memory (durable preferences)
 * - Level 4: Model interpretation (Context only, never authoritative)
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';

export type ConversationLifecycleStage =
  | 'NEW'
  | 'ACTIVE'
  | 'PRODUCT_INTEREST'
  | 'READY_TO_ORDER'
  | 'AWAITING_CUSTOMER'
  | 'AWAITING_HUMAN'
  | 'CONVERTED'
  | 'CLOSED';

export type CustomerLifecycleStage =
  | 'NEW_CUSTOMER'
  | 'PROSPECT'
  | 'INTERESTED'
  | 'ORDERED'
  | 'REPEAT_CUSTOMER';

export interface ConversationFacts {
  status: string; // OPEN, PENDING, RESOLVED, CLOSED
  closedAt?: Date | null;
  resolvedAt?: Date | null;
  aiEnabled: boolean;
  handoffAt?: Date | null;
  handoffReason?: string | null;
  messageCount: number;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  hasQualifyingOrder: boolean;
  hasDraftOrPendingOrder?: boolean;
  hasProductInquiryToolCalls?: boolean;
  productInquiries?: string[];
  hasOrderCreationToolCalls?: boolean;
  hasPendingApproval?: boolean;
}

export interface CustomerFacts {
  qualifyingOrdersCount: number;
  totalSpentMinor: number;
  lastOrderAt?: Date | null;
  leadStage?: string;
  status?: string;
  messageCount?: number;
  lastInteractionAt?: Date | null;
  hasProductInterest?: boolean;
  productPreferences?: string[];
  conversationStages?: ConversationLifecycleStage[];
}

export interface ConversationLifecycleContext {
  stage: ConversationLifecycleStage;
  label: string;
  reason: string;
  hasQualifyingOrder: boolean;
  isAwaitingHuman: boolean;
  lastActivityAt: Date | null;
  productInquiries: string[];
}

export interface CustomerLifecycleContext {
  stage: CustomerLifecycleStage;
  label: string;
  reason: string;
  qualifyingOrdersCount: number;
  totalSpentMinor: number;
  lastOrderAt: Date | null;
  hasProductInterest: boolean;
}

export type CustomerLifecycleResult = CustomerLifecycleContext;

export interface CombinedLifecycleContext {
  customer: CustomerLifecycleContext;
  conversation: ConversationLifecycleContext | null;
  formattedAiContext: string;
}

export const CONVERSATION_STAGE_LABELS: Record<ConversationLifecycleStage, string> = {
  NEW: 'New',
  ACTIVE: 'Active',
  PRODUCT_INTEREST: 'Product Interest',
  READY_TO_ORDER: 'Ready to Order',
  AWAITING_CUSTOMER: 'Awaiting Customer',
  AWAITING_HUMAN: 'Awaiting Human',
  CONVERTED: 'Converted',
  CLOSED: 'Closed',
};

export const CUSTOMER_STAGE_LABELS: Record<CustomerLifecycleStage, string> = {
  NEW_CUSTOMER: 'New Customer',
  PROSPECT: 'Prospect',
  INTERESTED: 'Interested',
  ORDERED: 'Ordered',
  REPEAT_CUSTOMER: 'Repeat Customer',
};

/**
 * Product-related tools that indicate explicit product discovery / interest.
 */
const PRODUCT_INTEREST_TOOLS = new Set([
  'search_products',
  'get_product',
  'check_inventory',
]);

/**
 * Order-related tools that indicate checkout / purchasing intent.
 */
const ORDER_INTENT_TOOLS = new Set([
  'create_order',
]);

/**
 * Derives conversation lifecycle stage deterministically from facts.
 */
export function deriveConversationLifecycle(facts: ConversationFacts): ConversationLifecycleContext {
  const isClosed =
    facts.status === 'CLOSED' ||
    facts.status === 'RESOLVED' ||
    Boolean(facts.closedAt) ||
    Boolean(facts.resolvedAt);

  const isAwaitingHuman =
    !facts.aiEnabled ||
    Boolean(facts.handoffAt) ||
    facts.status === 'PENDING';

  const productInquiries = facts.productInquiries ?? [];

  // Priority 1: Closed thread
  if (isClosed) {
    return {
      stage: 'CLOSED',
      label: CONVERSATION_STAGE_LABELS.CLOSED,
      reason: 'Conversation is marked resolved or closed',
      hasQualifyingOrder: facts.hasQualifyingOrder,
      isAwaitingHuman: false,
      lastActivityAt: facts.lastOutboundAt ?? facts.lastInboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 2: Converted (direct chat qualifying order placed)
  if (facts.hasQualifyingOrder) {
    return {
      stage: 'CONVERTED',
      label: CONVERSATION_STAGE_LABELS.CONVERTED,
      reason: 'Qualifying order placed in this conversation thread',
      hasQualifyingOrder: true,
      isAwaitingHuman,
      lastActivityAt: facts.lastOutboundAt ?? facts.lastInboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 3: Awaiting human attention
  if (isAwaitingHuman) {
    return {
      stage: 'AWAITING_HUMAN',
      label: CONVERSATION_STAGE_LABELS.AWAITING_HUMAN,
      reason: 'Human takeover active, staff handoff requested, or status is pending',
      hasQualifyingOrder: false,
      isAwaitingHuman: true,
      lastActivityAt: facts.lastOutboundAt ?? facts.lastInboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 4: Ready to order (high intent: draft/pending order, approval pending, or create_order tool called)
  if (
    facts.hasDraftOrPendingOrder ||
    facts.hasOrderCreationToolCalls ||
    facts.hasPendingApproval
  ) {
    return {
      stage: 'READY_TO_ORDER',
      label: CONVERSATION_STAGE_LABELS.READY_TO_ORDER,
      reason: 'Order details provided or checkout initiated',
      hasQualifyingOrder: false,
      isAwaitingHuman: false,
      lastActivityAt: facts.lastOutboundAt ?? facts.lastInboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 5: Product interest (verified product query tool invocations)
  if (
    facts.hasProductInquiryToolCalls ||
    productInquiries.length > 0
  ) {
    return {
      stage: 'PRODUCT_INTEREST',
      label: CONVERSATION_STAGE_LABELS.PRODUCT_INTEREST,
      reason: 'Active inquiry regarding specific catalog items or inventory',
      hasQualifyingOrder: false,
      isAwaitingHuman: false,
      lastActivityAt: facts.lastOutboundAt ?? facts.lastInboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 6: Awaiting customer reply
  const lastOutbound = facts.lastOutboundAt ? new Date(facts.lastOutboundAt).getTime() : 0;
  const lastInbound = facts.lastInboundAt ? new Date(facts.lastInboundAt).getTime() : 0;
  if (lastOutbound > 0 && lastOutbound >= lastInbound) {
    return {
      stage: 'AWAITING_CUSTOMER',
      label: CONVERSATION_STAGE_LABELS.AWAITING_CUSTOMER,
      reason: 'Business or AI has replied; awaiting customer message',
      hasQualifyingOrder: false,
      isAwaitingHuman: false,
      lastActivityAt: facts.lastOutboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 7: Active dialogue
  if (facts.messageCount > 1 || (lastInbound > 0 && lastOutbound > 0)) {
    return {
      stage: 'ACTIVE',
      label: CONVERSATION_STAGE_LABELS.ACTIVE,
      reason: 'Ongoing bidirectional conversation',
      hasQualifyingOrder: false,
      isAwaitingHuman: false,
      lastActivityAt: facts.lastInboundAt ?? facts.lastOutboundAt ?? null,
      productInquiries,
    };
  }

  // Priority 8: New inquiry
  return {
    stage: 'NEW',
    label: CONVERSATION_STAGE_LABELS.NEW,
    reason: 'Initial customer inquiry',
    hasQualifyingOrder: false,
    isAwaitingHuman: false,
    lastActivityAt: facts.lastInboundAt ?? null,
    productInquiries,
  };
}

/**
 * Derives customer lifecycle stage deterministically from customer order & engagement facts.
 */
export function deriveCustomerLifecycle(facts: CustomerFacts): CustomerLifecycleContext {
  const count = facts.qualifyingOrdersCount;

  // Priority 1: Repeat customer (>= 2 qualifying orders)
  if (count >= 2) {
    return {
      stage: 'REPEAT_CUSTOMER',
      label: CUSTOMER_STAGE_LABELS.REPEAT_CUSTOMER,
      reason: `${count} qualifying orders completed`,
      qualifyingOrdersCount: count,
      totalSpentMinor: facts.totalSpentMinor,
      lastOrderAt: facts.lastOrderAt ?? null,
      hasProductInterest: Boolean(facts.hasProductInterest),
    };
  }

  // Priority 2: Ordered (exactly 1 qualifying order)
  if (count === 1) {
    return {
      stage: 'ORDERED',
      label: CUSTOMER_STAGE_LABELS.ORDERED,
      reason: 'First qualifying order completed',
      qualifyingOrdersCount: 1,
      totalSpentMinor: facts.totalSpentMinor,
      lastOrderAt: facts.lastOrderAt ?? null,
      hasProductInterest: Boolean(facts.hasProductInterest),
    };
  }

  // Priority 3: Interested (0 orders, but verified product interest / preferences)
  const hasDemonstratedInterest =
    Boolean(facts.hasProductInterest) ||
    (facts.productPreferences && facts.productPreferences.length > 0) ||
    (facts.conversationStages &&
      facts.conversationStages.some(
        (s) => s === 'PRODUCT_INTEREST' || s === 'READY_TO_ORDER',
      )) ||
    facts.leadStage === 'INTERESTED' ||
    facts.leadStage === 'QUALIFIED' ||
    facts.leadStage === 'NEGOTIATION';

  if (hasDemonstratedInterest) {
    return {
      stage: 'INTERESTED',
      label: CUSTOMER_STAGE_LABELS.INTERESTED,
      reason: 'Demonstrated interest in catalog products or active inquiry',
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      hasProductInterest: true,
    };
  }

  // Priority 4: Prospect (0 orders, but conversational interaction exists)
  const hasEngaged =
    (facts.messageCount != null && facts.messageCount > 1) ||
    Boolean(facts.lastInteractionAt) ||
    facts.leadStage === 'CONTACTED' ||
    facts.status === 'ACTIVE' ||
    (facts.conversationStages && facts.conversationStages.some((s) => s === 'ACTIVE'));

  if (hasEngaged) {
    return {
      stage: 'PROSPECT',
      label: CUSTOMER_STAGE_LABELS.PROSPECT,
      reason: 'Engaged in conversation history without prior qualifying orders',
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      hasProductInterest: false,
    };
  }

  // Priority 5: New Customer
  return {
    stage: 'NEW_CUSTOMER',
    label: CUSTOMER_STAGE_LABELS.NEW_CUSTOMER,
    reason: 'New contact with no prior qualifying orders or engagement history',
    qualifyingOrdersCount: 0,
    totalSpentMinor: 0,
    lastOrderAt: null,
    hasProductInterest: false,
  };
}

/**
 * Loads and calculates conversation lifecycle context from database.
 */
export async function getConversationLifecycle(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationLifecycleContext> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: {
      id: true,
      status: true,
      aiEnabled: true,
      handoffAt: true,
      handoffReason: true,
      messageCount: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      resolvedAt: true,
      closedAt: true,
    },
  });

  if (!conversation) {
    return {
      stage: 'NEW',
      label: CONVERSATION_STAGE_LABELS.NEW,
      reason: 'Conversation not found',
      hasQualifyingOrder: false,
      isAwaitingHuman: false,
      lastActivityAt: null,
      productInquiries: [],
    };
  }

  // Fetch qualifying orders attached to this conversation
  const qualifyingOrdersCount = await db.order.count({
    where: {
      workspaceId,
      conversationId: conversation.id,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
    },
  });

  // Fetch draft or pending orders attached to this conversation
  const draftOrPendingOrdersCount = await db.order.count({
    where: {
      workspaceId,
      conversationId: conversation.id,
      deletedAt: null,
      status: { in: ['DRAFT', 'PENDING'] },
    },
  });

  // Fetch pending action approvals attached to this conversation
  let pendingApprovalsCount = 0;
  if ('actionApproval' in db && db.actionApproval) {
    pendingApprovalsCount = await db.actionApproval.count({
      where: {
        workspaceId,
        conversationId: conversation.id,
        status: 'PENDING',
      },
    });
  }

  // Fetch recent AI turn tool activity to detect product inquiries or order creation attempts
  let hasProductInquiryToolCalls = false;
  let hasOrderCreationToolCalls = false;
  const productInquiries: string[] = [];

  if ('aITurn' in db && db.aITurn) {
    const recentTurns = await db.aITurn.findMany({
      where: {
        workspaceId,
        conversationId: conversation.id,
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        toolCalls: true,
      },
    });

    for (const turn of recentTurns) {
      if (Array.isArray(turn.toolCalls)) {
        for (const tc of turn.toolCalls) {
          const call = tc as { name?: string; arguments?: Record<string, unknown> };
          if (call?.name && PRODUCT_INTEREST_TOOLS.has(call.name)) {
            hasProductInquiryToolCalls = true;
            if (typeof call.arguments?.query === 'string' && call.arguments.query.trim()) {
              productInquiries.push(call.arguments.query.trim());
            } else if (typeof call.arguments?.name === 'string' && call.arguments.name.trim()) {
              productInquiries.push(call.arguments.name.trim());
            }
          }
          if (call?.name && ORDER_INTENT_TOOLS.has(call.name)) {
            hasOrderCreationToolCalls = true;
          }
        }
      }
    }
  }

  return deriveConversationLifecycle({
    status: conversation.status,
    closedAt: conversation.closedAt,
    resolvedAt: conversation.resolvedAt,
    aiEnabled: conversation.aiEnabled,
    handoffAt: conversation.handoffAt,
    handoffReason: conversation.handoffReason,
    messageCount: conversation.messageCount,
    lastInboundAt: conversation.lastInboundAt,
    lastOutboundAt: conversation.lastOutboundAt,
    hasQualifyingOrder: qualifyingOrdersCount > 0,
    hasDraftOrPendingOrder: draftOrPendingOrdersCount > 0,
    hasPendingApproval: pendingApprovalsCount > 0,
    hasProductInquiryToolCalls,
    hasOrderCreationToolCalls,
    productInquiries: Array.from(new Set(productInquiries)),
  });
}

/**
 * Loads and calculates customer lifecycle context from database.
 */
export async function getCustomerLifecycle(
  db: Db,
  workspaceId: string,
  contactId: string,
): Promise<CustomerLifecycleContext> {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: {
      id: true,
      leadStage: true,
      status: true,
      totalOrders: true,
      totalSpentMinor: true,
      lastOrderAt: true,
      lastInteractionAt: true,
    },
  });

  if (!contact) {
    return {
      stage: 'NEW_CUSTOMER',
      label: CUSTOMER_STAGE_LABELS.NEW_CUSTOMER,
      reason: 'Customer record not found',
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      hasProductInterest: false,
    };
  }

  // Count authoritative qualifying orders
  const qualifyingOrdersCount = await db.order.count({
    where: {
      workspaceId,
      contactId: contact.id,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
    },
  });

  // Calculate qualifying total spent
  const qualifyingSpentAgg = await db.order.aggregate({
    where: {
      workspaceId,
      contactId: contact.id,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT'] },
    },
    _sum: { totalMinor: true },
  });
  const totalSpentMinor = qualifyingSpentAgg._sum.totalMinor ?? 0;

  // Check customer memory for product preferences
  let hasProductInterest = false;
  const productPreferences: string[] = [];

  if ('customerMemory' in db && db.customerMemory) {
    const memories = await db.customerMemory.findMany({
      where: {
        workspaceId,
        contactId: contact.id,
      },
      take: 10,
      select: { category: true, key: true, value: true },
    });

    for (const mem of memories) {
      if (
        mem.category === 'PREFERENCE' ||
        mem.key.toLowerCase().includes('product') ||
        mem.key.toLowerCase().includes('interest')
      ) {
        hasProductInterest = true;
        productPreferences.push(mem.value);
      }
    }
  }

  return deriveCustomerLifecycle({
    qualifyingOrdersCount,
    totalSpentMinor,
    lastOrderAt: contact.lastOrderAt,
    leadStage: contact.leadStage,
    status: contact.status,
    lastInteractionAt: contact.lastInteractionAt,
    hasProductInterest,
    productPreferences,
  });
}

/**
 * Loads combined customer and conversation lifecycle context for an active conversation.
 */
export async function getCombinedLifecycleContext(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<CombinedLifecycleContext> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true, contactId: true },
  });

  if (!conversation) {
    const defaultCustomer: CustomerLifecycleContext = {
      stage: 'NEW_CUSTOMER',
      label: CUSTOMER_STAGE_LABELS.NEW_CUSTOMER,
      reason: 'No conversation found',
      qualifyingOrdersCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      hasProductInterest: false,
    };
    return {
      customer: defaultCustomer,
      conversation: null,
      formattedAiContext: formatLifecycleForAiPrompt({
        customer: defaultCustomer,
        conversation: null,
      }),
    };
  }

  const [conversationLifecycle, customerLifecycle] = await Promise.all([
    getConversationLifecycle(db, workspaceId, conversation.id),
    getCustomerLifecycle(db, workspaceId, conversation.contactId),
  ]);

  const combined: CombinedLifecycleContext = {
    customer: customerLifecycle,
    conversation: conversationLifecycle,
    formattedAiContext: '',
  };

  combined.formattedAiContext = formatLifecycleForAiPrompt(combined);
  return combined;
}

/**
 * Formats lifecycle context compactly and safely for the AI system prompt.
 *
 * Rules:
 * - Bounded to ~100 tokens
 * - Factual, non-speculative
 * - Explicitly tells AI this is context, not authorization to bypass rules
 */
export function formatLifecycleForAiPrompt(context: {
  customer: CustomerLifecycleContext;
  conversation: ConversationLifecycleContext | null;
}): string {
  const lines: string[] = ['=== Customer Journey Context ==='];

  // Customer line
  if (context.customer.stage === 'REPEAT_CUSTOMER') {
    lines.push(
      `Customer Relationship: REPEAT_CUSTOMER (${context.customer.qualifyingOrdersCount} completed orders)`,
    );
  } else if (context.customer.stage === 'ORDERED') {
    lines.push('Customer Relationship: ORDERED (1 completed order)');
  } else if (context.customer.stage === 'INTERESTED') {
    lines.push('Customer Relationship: INTERESTED (Active catalog interest, no orders placed yet)');
  } else if (context.customer.stage === 'PROSPECT') {
    lines.push('Customer Relationship: PROSPECT (Engaged customer, no orders placed yet)');
  } else {
    lines.push('Customer Relationship: NEW_CUSTOMER (First-time customer)');
  }

  // Conversation line
  if (context.conversation) {
    lines.push(
      `Current Conversation Stage: ${context.conversation.stage} (${context.conversation.reason})`,
    );
    if (context.conversation.productInquiries.length > 0) {
      const topInquiries = context.conversation.productInquiries.slice(0, 3).join(', ');
      lines.push(`Product Inquiries: ${topInquiries}`);
    }
  }

  lines.push(
    'Guideline: Use journey stage to tailor your conversational tone. Lifecycle stage does NOT authorize discounts or policy exceptions.',
  );

  return lines.join('\n');
}
