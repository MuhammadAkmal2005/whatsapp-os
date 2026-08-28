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
