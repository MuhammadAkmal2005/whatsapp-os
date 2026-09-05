/**
 * Usage Record Repository.
 *
 * Appends metering and billing ledger rows for AI requests and token consumption.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { Prisma } from '@prisma/client';

export type CreateAIUsageParams = {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicros?: number;
  metadata?: Record<string, unknown> | null;
};

export async function recordAIUsage(
  db: Db,
  params: CreateAIUsageParams,
): Promise<void> {
  const records: Prisma.UsageRecordCreateManyInput[] = [];

  // 1. AI Request counter
  records.push({
    workspaceId: params.workspaceId,
    metric: 'AI_REQUEST',
    quantity: 1,
    agentId: params.agentId ?? null,
    conversationId: params.conversationId ?? null,
    messageId: params.messageId ?? null,
    provider: params.provider ?? null,
    model: params.model ?? null,
    costMicros: params.costMicros ?? 0,
    metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  });

  // 2. Input tokens
  if (params.inputTokens > 0) {
    records.push({
      workspaceId: params.workspaceId,
      metric: 'AI_INPUT_TOKENS',
      quantity: params.inputTokens,
      agentId: params.agentId ?? null,
      conversationId: params.conversationId ?? null,
      messageId: params.messageId ?? null,
      provider: params.provider ?? null,
      model: params.model ?? null,
      costMicros: 0,
    });
  }

  // 3. Output tokens
  if (params.outputTokens > 0) {
    records.push({
      workspaceId: params.workspaceId,
      metric: 'AI_OUTPUT_TOKENS',
      quantity: params.outputTokens,
      agentId: params.agentId ?? null,
      conversationId: params.conversationId ?? null,
      messageId: params.messageId ?? null,
      provider: params.provider ?? null,
      model: params.model ?? null,
      costMicros: 0,
    });
  }

  await db.usageRecord.createMany({
    data: records,
  });
}

export type CreateEmbeddingUsageParams = {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  provider: string;
  /** The embedding model that produced the vector, not the generation model. */
  model: string;
  /**
   * Tokens the embedding call consumed, **locally estimated**.
   *
   * The Gemini Developer API returns no per-input token count for `embedContent`
   * (`ContentEmbeddingStatistics` is an Enterprise-tier field), so this is derived from
   * character length via `APPROX_CHARS_PER_TOKEN`. Named and documented as an estimate
   * everywhere it travels, because a billing figure that is silently approximate is
   * worse than one that is openly approximate.
   */
  estimatedInputTokens: number;
  costMicros: number;
};

/**
 * Appends the single ledger row for one embedding request.
 *
 * Deliberately not `recordAIUsage`. That function writes an `AI_REQUEST` counter and
 * files its tokens as `AI_INPUT_TOKENS` — correct for a generation call, wrong here
 * twice over: one customer message would count as two AI requests, and embedding tokens
 * priced at $0.15/M would be summed together with generation input tokens priced
 * differently. `AI_EMBEDDING_TOKENS` keeps retrieval's cost separable in analytics,
 * which is the only way to see that a workspace's bill is retrieval rather than replies.
 */
export async function recordEmbeddingUsage(
  db: Db,
  params: CreateEmbeddingUsageParams,
): Promise<void> {
  await db.usageRecord.create({
    data: {
      workspaceId: params.workspaceId,
      metric: 'AI_EMBEDDING_TOKENS',
      quantity: params.estimatedInputTokens,
      agentId: params.agentId ?? null,
      conversationId: params.conversationId ?? null,
      messageId: params.messageId ?? null,
      provider: params.provider,
      model: params.model,
      costMicros: params.costMicros,
    },
  });
}
