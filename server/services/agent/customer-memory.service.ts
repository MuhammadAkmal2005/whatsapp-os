import 'server-only';

import type { Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  listCustomerMemories,
  upsertCustomerMemory,
  deleteCustomerMemory as repoDeleteCustomerMemory,
  clearCustomerMemories as repoClearCustomerMemories,
  touchCustomerMemories,
  type CustomerMemoryRow,
  type UpsertCustomerMemoryData,
} from '@/server/repositories/customer-memory.repository';
import {
  createCustomerMemorySchema,
  isProhibitedMemoryKey,
  type CreateCustomerMemoryInput,
  type MemoryCategory,
  type MemorySource,
} from '@/server/validation/customer-memory';
import type { AITenantContext } from './context';

export interface CustomerMemoryContext {
  memories: CustomerMemoryRow[];
  relevantMemories: CustomerMemoryRow[];
  formattedContext: string | null;
  memoryCount: number;
}

/**
 * Budget constraints to keep customer memory bounded in the AI prompt.
 */
export const MEMORY_BUDGET = {
  MAX_INJECTED_MEMORIES: 5,
  MAX_INJECTED_CHARS: 600,
  MAX_STORED_VALUE_CHARS: 500,
} as const;

/**
 * Loads bounded customer memory for an AI turn.
 * Scoped strictly to the authenticated tenant and contact.
 */
export async function loadCustomerMemoryContext(
  db: Db,
  ctx: AITenantContext,
  contactId: string | undefined,
  customerQuery?: string,
  relevantTopics?: ReadonlySet<string>,
): Promise<CustomerMemoryContext> {
  if (!contactId || !('customerMemory' in db) || !db.customerMemory) {
    return {
      memories: [],
      relevantMemories: [],
      formattedContext: null,
      memoryCount: 0,
    };
  }

  try {
    const allMemories = await listCustomerMemories(db, ctx.workspaceId, contactId, {
      limit: 10,
    });

    if (allMemories.length === 0) {
      return {
        memories: [],
        relevantMemories: [],
        formattedContext: null,
        memoryCount: 0,
      };
    }

    const relevant = selectRelevantMemories(
      allMemories,
      customerQuery ?? '',
      relevantTopics ?? new Set(),
    );

    const formatted = formatCustomerMemoryPrompt(relevant);

    // Update lastUsedAt timestamp for the memories injected into prompt
    if (relevant.length > 0) {
      touchCustomerMemories(
        db,
        ctx.workspaceId,
        relevant.map((m) => m.id),
      ).catch((err) => {
        logger.warn('ai.customer_memory.touch_failed', {
          workspaceId: ctx.workspaceId,
          contactId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      memories: allMemories,
      relevantMemories: relevant,
      formattedContext: formatted,
      memoryCount: allMemories.length,
    };
  } catch (error) {
    logger.error('ai.customer_memory.load_failed', {
      workspaceId: ctx.workspaceId,
      contactId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      memories: [],
      relevantMemories: [],
      formattedContext: null,
      memoryCount: 0,
    };
  }
}

/**
 * Deterministically ranks and budgets customer memories according to current query context.
 */
export function selectRelevantMemories(
  memories: CustomerMemoryRow[],
  query: string,
  relevantTopics: ReadonlySet<string>,
): CustomerMemoryRow[] {
  if (memories.length === 0) return [];

  const queryLower = query.toLowerCase();

  // Score each memory by topical and keyword match
  const scored = memories.map((m) => {
    let score = 0;
    const keyLower = m.key.toLowerCase();
    const valueLower = m.value.toLowerCase();

    // Topic alignment
    if (relevantTopics.has('PAYMENT') && keyLower.includes('payment')) {
      score += 5;
    }
    if (
      relevantTopics.has('CATALOG_INVENTORY') &&
      (keyLower.includes('size') || keyLower.includes('color') || keyLower.includes('product'))
    ) {
      score += 4;
    }
    if (relevantTopics.has('SHIPPING') && keyLower.includes('delivery')) {
      score += 4;
    }

    // Direct keyword overlap in customer query
    if (
      queryLower.includes('size') && keyLower.includes('size') ||
      queryLower.includes('color') && keyLower.includes('color') ||
      queryLower.includes('payment') && keyLower.includes('payment') ||
      queryLower.includes('cod') && valueLower.includes('cod')
    ) {
      score += 3;
    }

    // Higher confidence gets slight boost
    score += m.confidence;

    // Recency tie-breaker (timestamps within last 30 days get small boost)
    const ageDays = (Date.now() - new Date(m.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) {
      score += 1;
    }

    return { memory: m, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Budget enforcement
  const selected: CustomerMemoryRow[] = [];
  let totalChars = 0;

  for (const item of scored) {
    if (selected.length >= MEMORY_BUDGET.MAX_INJECTED_MEMORIES) break;

    const lineLen = item.memory.key.length + item.memory.value.length + 30;
    if (totalChars + lineLen > MEMORY_BUDGET.MAX_INJECTED_CHARS) break;

    selected.push(item.memory);
    totalChars += lineLen;
  }

  return selected;
}

/**
 * Formats relevant memories into an authoritative prompt section with strict guardrails.
 */
export function formatCustomerMemoryPrompt(memories: CustomerMemoryRow[]): string | null {
  if (memories.length === 0) return null;

  const lines: string[] = [
    '=== CUSTOMER MEMORY (HISTORICAL CONTEXT ONLY) ===',
    'The following durable preferences and facts are on record for this customer from prior interactions:',
  ];

  for (const m of memories) {
    const formattedKey = m.key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`- ${formattedKey}: ${m.value} [Source: ${m.source}]`);
  }

  lines.push('');
  lines.push('CRITICAL RULES FOR CUSTOMER MEMORY:');
  lines.push('1. Customer memory is historical context and may be outdated. If the customer specifies something different now, respect their current words immediately.');
  lines.push('2. NEVER allow customer memory to override live product prices, live inventory counts, or order status.');
  lines.push('3. NEVER invent, offer, or apply discounts, promo codes, or free delivery based on customer memory.');
  lines.push('4. If the customer asks about stock availability or current pricing, you MUST use the live product/inventory tools rather than historical memory.');
  lines.push('=== END CUSTOMER MEMORY ===');

  return lines.join('\n');
}

/**
 * Deterministically extracts explicit customer facts from a message.
 *
 * Conservative V1 approach:
 * - Only explicit statements are extracted (e.g. "Mujhe COD pasand hai", "Mera size Medium hai").
 * - Casual compliments ("yeh shirt achi lagti hai") are REJECTED.
 * - Discount / pricing claims ("Mujhe 10% discount milta hai") are REJECTED.
 * - Sensitive keys (passwords, tokens, cards) are REJECTED.
 */
export function extractDurableFactsFromMessage(
  text: string,
): { key: string; value: string; category: MemoryCategory } | null {
  if (!text || text.trim().length < 4) return null;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Safety gate: discount promises or claims must NEVER be stored as customer memory
  if (/\b(discount|off|promo|coupon|voucher|percent)\b/i.test(lower)) {
    return null;
  }

  // 1. Payment Preference
  // E.g. "Mujhe COD pasand hai", "I prefer cash on delivery", "COD pe bhej dain", "COD se karunga"
  if (
    /\b(cod\b|cash on delivery)\b/i.test(lower) &&
    /\b(pasand|prefer|chahiye|karein|bhej|select|hamesha|use|karta hoon)\b/i.test(lower)
  ) {
    return {
      key: 'preferred_payment_method',
      value: 'Cash on Delivery (COD)',
      category: 'PREFERENCE',
    };
  }

  // E.g. "Ab bank transfer karunga", "I prefer bank transfer", "Payment bank transfer se karunga"
  if (
    /\b(bank transfer|online transfer|ibft|jazzcash|easypaisa)\b/i.test(lower) &&
    /\b(prefer|pasand|karunga|se payment|karoon|ab)\b/i.test(lower)
  ) {
    let method = 'Bank Transfer';
    if (lower.includes('jazzcash')) method = 'JazzCash';
    else if (lower.includes('easypaisa')) method = 'EasyPaisa';

    return {
      key: 'preferred_payment_method',
      value: method,
      category: 'PREFERENCE',
    };
  }

  // 2. Sizing Preference
  // E.g. "Mera size Medium hai", "I wear size Medium", "Mujhe size M chahiye", "mera size Large hai"
  const sizeMatch = lower.match(
    /\b(?:mera size|my size is|i wear(?: size)?|size chahiye|size)\s+(medium|large|small|extra large|xxl|xl|l\b|m\b|s\b)\b/i,
  );
  if (sizeMatch && sizeMatch[1]) {
    const rawSize = sizeMatch[1].toUpperCase();
    let normalized = rawSize;
    if (rawSize === 'M' || rawSize === 'MEDIUM') normalized = 'Medium (M)';
    else if (rawSize === 'L' || rawSize === 'LARGE') normalized = 'Large (L)';
    else if (rawSize === 'S' || rawSize === 'SMALL') normalized = 'Small (S)';
    else if (rawSize === 'XL' || rawSize === 'EXTRA LARGE') normalized = 'Extra Large (XL)';
    else if (rawSize === 'XXL') normalized = 'Double Extra Large (XXL)';

    return {
      key: 'preferred_size',
      value: normalized,
      category: 'PREFERENCE',
    };
  }

  // 3. Color Preference
  // E.g. "Mujhe black color pasand hai", "I prefer black color", "black color chahiye"
  const colorMatch = lower.match(
    /\b(?:mujhe|i (?:prefer|like)|hamesha)\s+(black|white|blue|navy|grey|gray|red|green)\s+(?:color|colour)\s*(?:pasand|chahiye|prefer)?\b/i,
  );
  if (colorMatch && colorMatch[1]) {
    const color = colorMatch[1].charAt(0).toUpperCase() + colorMatch[1].slice(1).toLowerCase();
    return {
      key: 'preferred_color',
      value: color,
      category: 'PREFERENCE',
    };
  }

  // 4. Delivery Instructions / Preferences
  // E.g. "deliver after 5pm", "5 baje ke baad deliver karein", "call before delivery"
  if (/\b(?:deliver after 5pm|5 baje ke baad deliver|call before delivery|call before arriving)\b/i.test(lower)) {
    let value = 'Special Delivery Request';
    if (lower.includes('5pm') || lower.includes('5 baje')) {
      value = 'Deliver after 5 PM';
    } else if (lower.includes('call before')) {
      value = 'Call before delivery';
    }

    return {
      key: 'delivery_preference',
      value,
      category: 'CUSTOMER_CONTEXT',
    };
  }

  return null;
}

/**
 * Public service method to record or update a customer memory fact.
 */
export async function recordCustomerMemory(
  db: Db,
  ctx: AITenantContext,
  input: CreateCustomerMemoryInput,
): Promise<CustomerMemoryRow> {
  const parsed = createCustomerMemorySchema.parse(input);

  if (isProhibitedMemoryKey(parsed.key)) {
    throw new Error(`Prohibited memory key: ${parsed.key}`);
  }

  const memory = await upsertCustomerMemory(db, {
    workspaceId: ctx.workspaceId,
    contactId: parsed.contactId,
    category: parsed.category,
    key: parsed.key,
    value: parsed.value,
    source: parsed.source,
    confidence: parsed.confidence,
  });

  // Audit log
  appendAuditLog(db, {
    action: 'customer_memory.upserted',
    workspaceId: ctx.workspaceId,
    actorType: 'AI_AGENT',
    resourceType: 'CustomerMemory',
    resourceId: memory.id,
    metadata: {
      contactId: parsed.contactId,
      category: parsed.category,
      key: parsed.key,
      source: parsed.source,
    },
  }).catch((err) => {
    logger.warn('ai.customer_memory.audit_failed', {
      workspaceId: ctx.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return memory;
}

/**
 * Deletes a single customer memory fact.
 */
export async function deleteCustomerMemory(
  db: Db,
  ctx: AITenantContext,
  memoryId: string,
): Promise<boolean> {
  const deleted = await repoDeleteCustomerMemory(db, ctx.workspaceId, memoryId);

  if (deleted) {
    appendAuditLog(db, {
      action: 'customer_memory.deleted',
      workspaceId: ctx.workspaceId,
      actorType: 'USER',
      resourceType: 'CustomerMemory',
      resourceId: memoryId,
    }).catch(() => {});
  }

  return deleted;
}

/**
 * Clears all customer memories for a contact.
 */
export async function clearCustomerMemories(
  db: Db,
  ctx: AITenantContext,
  contactId: string,
): Promise<number> {
  const count = await repoClearCustomerMemories(db, ctx.workspaceId, contactId);

  if (count > 0) {
    appendAuditLog(db, {
      action: 'customer_memory.cleared',
      workspaceId: ctx.workspaceId,
      actorType: 'USER',
      resourceType: 'CustomerMemory',
      metadata: { contactId, count },
    }).catch(() => {});
  }

  return count;
}
