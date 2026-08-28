/**
 * AI Turn Repository.
 *
 * Persists the audit trail and telemetry for every AI execution.
 * Records model usage, tool calls, grounding state, and handoff decisions.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import type { Prisma } from '@prisma/client';
import { assertBelongsToWorkspace } from '@/server/tenancy/context';
import type { HandoffReason } from '@/server/validation/conversation';

export type TurnSource = 'CONVERSATION' | 'PLAYGROUND' | 'AUTOMATION';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export type CreateAITurnInput = {
  workspaceId: string;
  conversationId?: string | null;
  messageId?: string | null;
  agentId: string;
  source?: TurnSource;
  inputText: string;
  outputText?: string | null;
  intent?: string | null;
  provider: string;
  model: string;
  confidence?: number | null;
  confidenceBand?: ConfidenceBand | null;
  retrievedChunkIds?: string[];
  retrievalTopScore?: number | null;
  toolCalls?: unknown | null;
  groundingPassed?: boolean;
  blockedReason?: string | null;
  handoffTriggered?: boolean;
  handoffReason?: HandoffReason | null;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  latencyMs?: number;
  errorMessage?: string | null;
};

export type AITurnRow = {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  messageId: string | null;
  agentId: string;
  source: TurnSource;
  inputText: string;
  outputText: string | null;
  intent: string | null;
  provider: string;
  model: string;
  confidence: number | null;
  confidenceBand: ConfidenceBand | null;
  retrievedChunkIds: string[];
  retrievalTopScore: number | null;
  toolCalls: unknown | null;
  groundingPassed: boolean;
  blockedReason: string | null;
  handoffTriggered: boolean;
  handoffReason: HandoffReason | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  errorMessage: string | null;
  createdAt: Date;
};

export async function createAITurn(
  db: Db,
  input: CreateAITurnInput,
): Promise<AITurnRow> {
  const row = await db.aITurn.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      agentId: input.agentId,
      source: input.source ?? 'CONVERSATION',
      inputText: input.inputText,
      outputText: input.outputText ?? null,
      intent: input.intent ?? null,
      provider: input.provider,
      model: input.model,
      confidence: input.confidence ?? null,
      confidenceBand: input.confidenceBand ?? null,
      retrievedChunkIds: input.retrievedChunkIds ?? [],
      retrievalTopScore: input.retrievalTopScore ?? null,
      toolCalls: input.toolCalls
        ? (JSON.parse(JSON.stringify(input.toolCalls)) as Prisma.InputJsonValue)
        : undefined,
      groundingPassed: input.groundingPassed ?? true,
      blockedReason: input.blockedReason ?? null,
      handoffTriggered: input.handoffTriggered ?? false,
      handoffReason: input.handoffReason ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      costMicros: input.costMicros ?? 0,
      latencyMs: input.latencyMs ?? 0,
      errorMessage: input.errorMessage ?? null,
    },
  });

  return assertBelongsToWorkspace(row, input.workspaceId, 'AITurn') as unknown as AITurnRow;
}

export async function findAITurnById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<AITurnRow | null> {
  const row = await db.aITurn.findFirst({
    where: { id, workspaceId },
  });

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AITurn') as unknown as AITurnRow;
}

export async function findAITurnByMessageId(
  db: Db,
  workspaceId: string,
  messageId: string,
): Promise<AITurnRow | null> {
  const row = await db.aITurn.findFirst({
    where: { messageId, workspaceId },
  });

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AITurn') as unknown as AITurnRow;
}
