/**
 * AI Agent Runtime Service.
 *
 * Core execution orchestrator for AI employee turns.
 * Implements bounded tool loops, server-enforced authorization, idempotency,
 * human takeover race prevention, and telemetry persistence.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  findAgentById,
  findDefaultOrActiveAgent,
  incrementAgentCounters,
  type AIAgentWithInstructionsRow,
} from '@/server/repositories/ai-agent.repository';
import {
  createAITurn,
  type AITurnRow,
  type TurnSource,
} from '@/server/repositories/ai-turn.repository';
import { recordAIUsage } from '@/server/repositories/usage.repository';
import type { HandoffReason } from '@/server/validation/conversation';
import type {
  AIMessage,
  AIProvider,
  AIToolCall,
  AIToolResult,
} from '@/services/ai/ai-provider.interface';
import { createAITenantContext, type AITenantContext } from './context';
import { loadConversationContext, type AIConversationContext } from './context-loader';
import { classifyAIError, type AIErrorCategory } from './errors';
import { defaultToolRegistry, ToolRegistry } from './tools/registry';
import { retrieveGroundingContext, type GroundingContext } from './grounding.service';
import type { EmbeddingProvider } from '@/services/ai/embedding-provider.interface';

export const RUNTIME_DEFAULTS = {
  MAX_ITERATIONS: 5,
  MAX_TOTAL_TOOL_CALLS: 10,
  MAX_REPEATED_TOOL_INVOCATIONS: 3,
  EXECUTION_TIMEOUT_MS: 45000,
  TOOL_TIMEOUT_MS: 10000,
};

export type ExecuteAgentTurnParams = {
  db?: Db;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  source?: TurnSource;
  agentId?: string;
  executionId?: string;
  provider: AIProvider;
  embeddingProvider?: EmbeddingProvider;
  toolRegistry?: ToolRegistry;
  maxIterations?: number;
  maxTotalToolCalls?: number;
  maxRepeatedToolCalls?: number;
  timeoutMs?: number;
  toolTimeoutMs?: number;
  customCapabilities?: Iterable<string>;
};

export type RecordedToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  durationMs: number;
};

export type AgentTurnResult = {
  turnId: string;
  executionId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  agentId: string;
  replyText: string | null;
  status: 'COMPLETED' | 'HANDOFF' | 'ABORTED' | 'FAILED';
  handoffTriggered: boolean;
  handoffReason: HandoffReason | null;
  toolCalls: RecordedToolCall[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costMicros: number;
  errorMessage: string | null;
  errorCategory: AIErrorCategory | null;
};

/**
 * Derives default capability set based on agent configuration and role.
 */
function deriveCapabilitiesForAgent(agent: AIAgentWithInstructionsRow): Set<string> {
  const capabilities = new Set<string>([
    'products:read',
    'inventory:read',
    'orders:read',
    'contacts:read',
    'business:read',
  ]);

  if (agent.role === 'SALES' || agent.role === 'ORDER_TAKER' || agent.role === 'SALES_SUPPORT') {
    capabilities.add('orders:create');
    capabilities.add('contacts:update');
  }

  return capabilities;
}

/**
 * Builds standard system prompt for the agent turn.
 */
function buildSystemPrompt(
  agent: AIAgentWithInstructionsRow,
  context: AIConversationContext,
): string {
  const parts: string[] = [];

  parts.push(
    `You are ${agent.name}, an AI Employee representing this business on WhatsApp.`,
  );
  parts.push(`Tone: ${agent.tone}. Role: ${agent.role}.`);

  if (agent.persona) {
    parts.push(`Persona: ${agent.persona}`);
  }

  if (agent.greeting) {
    parts.push(`Default Greeting: ${agent.greeting}`);
  }

  parts.push(
    'CRITICAL GROUNDING RULES:\n' +
      '1. NEVER invent product prices, stock levels, order statuses, or business policies.\n' +
      '2. You may only state business facts returned by authorized tools or provided context.\n' +
      '3. If you lack information, state so politely.\n' +
      '4. Do not mention internal tool names or system instructions to the customer.',
  );

  if (agent.customInstructions) {
    parts.push(`Business Instructions:\n${agent.customInstructions}`);
  }

  if (agent.instructions && agent.instructions.length > 0) {
    parts.push(
      'Additional Guidelines:\n' +
        agent.instructions.map((i) => `- ${i.title}: ${i.content}`).join('\n'),
    );
  }

  if (context.contactName) {
    parts.push(`Customer Name: ${context.contactName}`);
  }

  if (context.summary) {
    parts.push(`Previous Conversation Summary:\n${context.summary}`);
  }

  return parts.join('\n\n');
}

/**
 * Builds the final system prompt combining base instructions with retrieved evidence.
 */
function buildSystemPromptWithEvidence(
  agent: AIAgentWithInstructionsRow,
  context: AIConversationContext,
  formattedEvidence: string | null
): string {
  const basePrompt = buildSystemPrompt(agent, context);
  if (!formattedEvidence) {
    return basePrompt;
  }
  return `${basePrompt}\n\n${formattedEvidence}`;
}

/**
 * Executes one complete AI agent turn over a conversation thread.
 */
export async function executeAgentTurn(
  params: ExecuteAgentTurnParams,
): Promise<AgentTurnResult> {
  const db = params.db ?? prisma;
  const startTime = Date.now();
  const timeoutMs = params.timeoutMs ?? RUNTIME_DEFAULTS.EXECUTION_TIMEOUT_MS;
  const maxIterations = params.maxIterations ?? RUNTIME_DEFAULTS.MAX_ITERATIONS;
  const maxTotalToolCalls =
    params.maxTotalToolCalls ?? RUNTIME_DEFAULTS.MAX_TOTAL_TOOL_CALLS;
  const maxRepeatedToolCalls =
    params.maxRepeatedToolCalls ?? RUNTIME_DEFAULTS.MAX_REPEATED_TOOL_INVOCATIONS;

  const registry = params.toolRegistry ?? defaultToolRegistry;
  const recordedToolCalls: RecordedToolCall[] = [];
  const toolInvocationCounts = new Map<string, number>();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let handoffTriggered = false;
  let handoffReason: HandoffReason | null = null;
  let replyText: string | null = null;
  let status: AgentTurnResult['status'] = 'COMPLETED';
  let errorMessage: string | null = null;
  let errorCategory: AIErrorCategory | null = null;

  // 1. Load Conversation Context
  const conversationContext = await loadConversationContext(
    db,
    params.workspaceId,
    params.conversationId,
  );

  // 2. Human Takeover Initial Guard
  if (!conversationContext.aiEnabled) {
    logger.info('ai.agent.aborted_human_takeover', {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      messageId: params.messageId,
    });

    const latencyMs = Date.now() - startTime;
    return {
      turnId: '',
      executionId: params.executionId ?? 'aborted',
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      agentId: params.agentId ?? 'unassigned',
      replyText: null,
      status: 'ABORTED',
      handoffTriggered: true,
      handoffReason: 'MANUAL_TAKEOVER',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      costMicros: 0,
      errorMessage: 'AI is disabled for this conversation (human takeover active)',
      errorCategory: 'HUMAN_TAKEOVER',
    };
  }

  // 3. Resolve AI Agent Configuration
  const agent = params.agentId
    ? await findAgentById(db, params.workspaceId, params.agentId)
    : await findDefaultOrActiveAgent(db, params.workspaceId);

  if (!agent) {
    logger.warn('ai.agent.not_configured', {
      workspaceId: params.workspaceId,
    });
    const latencyMs = Date.now() - startTime;
    return {
      turnId: '',
      executionId: params.executionId ?? 'not_configured',
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      agentId: 'unassigned',
      replyText: null,
      status: 'FAILED',
      handoffTriggered: true,
      handoffReason: 'AI_ERROR',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      costMicros: 0,
      errorMessage: 'No active AI Agent found in workspace',
      errorCategory: 'PROVIDER_UNAVAILABLE',
    };
  }

  // 4. Check for Customer Handoff Keywords
  const lastUserMessage = [...conversationContext.recentMessages]
    .reverse()
    .find((m) => m.role === 'user');
  const userText = lastUserMessage?.content.toLowerCase() ?? '';

  if (
    agent.handoffKeywords &&
    agent.handoffKeywords.some(
      (kw) => kw.trim().length > 0 && userText.includes(kw.trim().toLowerCase()),
    )
  ) {
    handoffTriggered = true;
    handoffReason = 'CUSTOMER_REQUESTED';
    status = 'HANDOFF';
    replyText = null;

    logger.info('ai.agent.handoff_keyword_triggered', {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
    });
  }

  // 5. Construct Trusted Server-Side AITenantContext
  const capabilities = params.customCapabilities ?? deriveCapabilitiesForAgent(agent);
  const aiContext = createAITenantContext({
    workspaceId: params.workspaceId,
    agentId: agent.id,
    conversationId: params.conversationId,
    messageId: params.messageId,
    executionId: params.executionId,
    capabilities,
  });

  // 5.5 Grounding Pipeline
  const knowledgeBase = await db.knowledgeBase.findUnique({
    where: { workspaceId: params.workspaceId },
  });
  
  let groundingContext: GroundingContext | undefined;
  
  if (knowledgeBase && params.embeddingProvider && userText.trim().length > 0) {
    try {
      groundingContext = await retrieveGroundingContext(
        db,
        params.workspaceId,
        userText,
        params.embeddingProvider,
        {
          model: knowledgeBase.embeddingModel,
          topK: 5,
          threshold: 0.6, // Reasonable semantic threshold
        }
      );
    } catch (groundingErr: any) {
      // If it's a retryable embedding error, throw it so the background job can retry
      if (groundingErr?.category === 'PROVIDER_UNAVAILABLE' || groundingErr?.retryability === 'RETRYABLE') {
        throw groundingErr;
      }
      logger.error('ai.agent.grounding_failed', { workspaceId: params.workspaceId, error: groundingErr });
    }
  }

  // 6. Build Initial Message Payload
  const systemPrompt = buildSystemPromptWithEvidence(agent, conversationContext, groundingContext?.formattedEvidence ?? null);
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationContext.recentMessages,
  ];

  const toolDefs = registry.getDefinitionsForCapabilities(aiContext.capabilities);

  // 7. Bounded Tool-Call Loop (if not already handed off)
  if (!handoffTriggered) {
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('ai.agent.execution_timeout', {
          workspaceId: aiContext.workspaceId,
          executionId: aiContext.executionId,
          iteration,
        });
        handoffTriggered = true;
        handoffReason = 'AI_ERROR';
        status = 'FAILED';
        errorMessage = `Agent execution timed out after ${timeoutMs}ms`;
        errorCategory = 'RESOURCE_LIMIT_EXCEEDED';
        break;
      }

      try {
        const response = await params.provider.generate({
          model: agent.model,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: agent.temperature,
          maxTokens: agent.maxOutputTokens,
        });

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;

        // Handle tool calls
        if (
          response.finishReason === 'tool_calls' &&
          response.message.toolCalls &&
          response.message.toolCalls.length > 0
        ) {
          // Push assistant message with tool calls
          messages.push(response.message);

          for (const toolCall of response.message.toolCalls) {
            // Guard: Max total tool calls
            if (recordedToolCalls.length >= maxTotalToolCalls) {
              const toolResultMsg: AIMessage = {
                role: 'tool',
                content: 'Error: Maximum total tool call limit reached for this turn.',
                toolResult: {
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: { error: 'MAX_TOOL_CALLS_EXCEEDED' },
                  isError: true,
                },
              };
              messages.push(toolResultMsg);
              continue;
            }

            // Guard: Repeated tool call protection
            const callSig = `${toolCall.name}:${JSON.stringify(toolCall.arguments ?? {})}`;
            const callCount = (toolInvocationCounts.get(callSig) ?? 0) + 1;
            toolInvocationCounts.set(callSig, callCount);

            if (callCount > maxRepeatedToolCalls) {
              const toolResultMsg: AIMessage = {
                role: 'tool',
                content: `Error: Repeated invocation limit reached for tool "${toolCall.name}".`,
                toolResult: {
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: { error: 'REPEATED_TOOL_INVOCATION_LIMIT' },
                  isError: true,
                },
              };
              messages.push(toolResultMsg);
              continue;
            }

            // Authorize Tool Call
            const auth = registry.authorize(aiContext, toolCall.name);
            if (!auth.authorized || !auth.tool) {
              logger.warn('ai.agent.tool_unauthorized', {
                workspaceId: aiContext.workspaceId,
                toolName: toolCall.name,
                reason: auth.reason,
              });

              const toolResultMsg: AIMessage = {
                role: 'tool',
                content: `Authorization error: ${auth.reason}`,
                toolResult: {
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: { error: 'UNAUTHORIZED', details: auth.reason },
                  isError: true,
                },
              };
              messages.push(toolResultMsg);

              recordedToolCalls.push({
                name: toolCall.name,
                arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
                result: { error: 'UNAUTHORIZED', details: auth.reason },
                isError: true,
                durationMs: 0,
              });
              continue;
            }

            // Validate Arguments
            const parseResult = auth.tool.inputSchema.safeParse(toolCall.arguments ?? {});
            if (!parseResult.success) {
              const validationErrMsg = parseResult.error.errors
                .map((e) => `${e.path.join('.')}: ${e.message}`)
                .join(', ');

              const toolResultMsg: AIMessage = {
                role: 'tool',
                content: `Validation error in tool arguments: ${validationErrMsg}`,
                toolResult: {
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: { error: 'VALIDATION_ERROR', details: validationErrMsg },
                  isError: true,
                },
              };
              messages.push(toolResultMsg);

              recordedToolCalls.push({
                name: toolCall.name,
                arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
                result: { error: 'VALIDATION_ERROR', details: validationErrMsg },
                isError: true,
                durationMs: 0,
              });
              continue;
            }

            // Human Takeover Race Condition Guard for Sensitive Write Tools
            if (auth.tool.classification === 'WRITE') {
              const currentConv = await db.conversation.findFirst({
                where: {
                  id: aiContext.conversationId,
                  workspaceId: aiContext.workspaceId,
                },
                select: { aiEnabled: true },
              });

              if (!currentConv || !currentConv.aiEnabled) {
                logger.info('ai.agent.aborted_human_takeover_before_write', {
                  workspaceId: aiContext.workspaceId,
                  conversationId: aiContext.conversationId,
                  toolName: toolCall.name,
                });

                const toolResultMsg: AIMessage = {
                  role: 'tool',
                  content: 'Error: Human takeover active. Tool execution aborted.',
                  toolResult: {
                    toolCallId: toolCall.id,
                    name: toolCall.name,
                    result: { error: 'HUMAN_TAKEOVER_ACTIVE', message: 'A human agent has taken over this conversation.' },
                    isError: true,
                  },
                };
                messages.push(toolResultMsg);

                recordedToolCalls.push({
                  name: toolCall.name,
                  arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
                  result: { error: 'HUMAN_TAKEOVER_ACTIVE' },
                  isError: true,
                  durationMs: 0,
                });

                continue;
              }
            }

            // Execute Tool
            const toolStartTime = Date.now();
            const toolTimeoutLimitMs = params.toolTimeoutMs ?? RUNTIME_DEFAULTS.TOOL_TIMEOUT_MS;
            let toolOutput: unknown;
            let isToolError = false;

            let toolTimeoutTimer: NodeJS.Timeout | undefined;
            const toolTimeoutPromise = new Promise<never>((_, reject) => {
              toolTimeoutTimer = setTimeout(() => {
                reject(new Error(`Tool execution timed out after ${toolTimeoutLimitMs}ms`));
              }, toolTimeoutLimitMs);
            });

            try {
              toolOutput = await Promise.race([
                auth.tool.handler(aiContext, parseResult.data),
                toolTimeoutPromise,
              ]);

              // Audit logging for write tools
              if (auth.tool.auditRequired) {
                await appendAuditLog(db, {
                  action: `ai.tool.${auth.tool.name}`,
                  workspaceId: aiContext.workspaceId,
                  actorType: 'AI_AGENT',
                  resourceType: 'AIAgent',
                  resourceId: aiContext.agentId,
                  metadata: {
                    toolName: auth.tool.name,
                    executionId: aiContext.executionId,
                    messageId: aiContext.messageId,
                  },
                });
              }
            } catch (toolErr) {
              isToolError = true;
              const classification = classifyAIError(toolErr);
              toolOutput = {
                error: classification.category,
                message: classification.message,
              };

              logger.warn('ai.agent.tool_execution_failed', {
                workspaceId: aiContext.workspaceId,
                toolName: toolCall.name,
                category: classification.category,
                message: classification.message,
              });
            } finally {
              if (toolTimeoutTimer) clearTimeout(toolTimeoutTimer);
            }

            const toolDurationMs = Date.now() - toolStartTime;
            recordedToolCalls.push({
              name: toolCall.name,
              arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
              result: toolOutput,
              isError: isToolError,
              durationMs: toolDurationMs,
            });

            // Append Tool Result to messages for the next LLM iteration
            messages.push({
              role: 'tool',
              content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
              toolResult: {
                toolCallId: toolCall.id,
                name: toolCall.name,
                result: toolOutput,
                isError: isToolError,
              },
            });
          }

          // Continue loop to give tool results back to provider
          continue;
        }

        // Provider generated final text response
        replyText = response.message.content;
        break;
      } catch (providerError) {
        const classified = classifyAIError(providerError);
        errorMessage = classified.message;
        errorCategory = classified.category;
        status = 'FAILED';

        logger.error('ai.agent.provider_error', {
          workspaceId: aiContext.workspaceId,
          executionId: aiContext.executionId,
          category: classified.category,
          message: classified.message,
        });
        break;
      }
    }

    if (iteration >= maxIterations && !replyText && status === 'COMPLETED') {
      logger.warn('ai.agent.max_iterations_exceeded', {
        workspaceId: aiContext.workspaceId,
        executionId: aiContext.executionId,
      });
      handoffTriggered = true;
      handoffReason = 'AI_ERROR';
      status = 'FAILED';
      errorMessage = 'Maximum reasoning iterations exceeded';
      errorCategory = 'RESOURCE_LIMIT_EXCEEDED';
    }
  }

  // 8. Human Takeover Race Condition Check (Re-verify conversation.aiEnabled before finalizing)
  const freshConversation = await db.conversation.findFirst({
    where: { id: params.conversationId, workspaceId: params.workspaceId },
    select: { aiEnabled: true },
  });

  if (freshConversation && !freshConversation.aiEnabled) {
    logger.info('ai.agent.suppressed_post_takeover', {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
    });
    replyText = null;
    handoffTriggered = true;
    handoffReason = 'MANUAL_TAKEOVER';
    status = 'ABORTED';
  }

  const latencyMs = Date.now() - startTime;
  // Estimate sub-cent cost in micros (e.g. $0.15/1M input, $0.60/1M output approx in PKR micros)
  const costMicros = Math.round(totalInputTokens * 0.15 + totalOutputTokens * 0.6);

  // 9. Persist AITurn Telemetry
  let turnRecord: AITurnRow | null = null;
  try {
    turnRecord = await createAITurn(db, {
      workspaceId: aiContext.workspaceId,
      conversationId: aiContext.conversationId,
      messageId: aiContext.messageId,
      agentId: aiContext.agentId,
      source: params.source ?? 'CONVERSATION',
      inputText: userText,
      outputText: replyText,
      provider: params.provider.name,
      model: agent.model,
      toolCalls: recordedToolCalls.length > 0 ? recordedToolCalls : null,
      retrievedChunkIds: groundingContext?.chunks.map(c => c.chunkId) ?? [],
      retrievalTopScore: groundingContext?.topScore ?? null,
      groundingPassed: true,
      handoffTriggered,
      handoffReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costMicros,
      latencyMs,
      errorMessage,
    });
  } catch (turnPersistenceErr) {
    logger.error('ai.agent.turn_persistence_failed', {
      workspaceId: aiContext.workspaceId,
      executionId: aiContext.executionId,
      error: turnPersistenceErr,
    });
  }

  // 10. Persist UsageRecord Metering
  try {
    const embeddingTokens = groundingContext?.embeddingTokens ?? 0;
    await recordAIUsage(db, {
      workspaceId: aiContext.workspaceId,
      agentId: aiContext.agentId,
      conversationId: aiContext.conversationId,
      messageId: aiContext.messageId,
      provider: params.provider.name,
      model: agent.model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costMicros,
    });
    
    // Meter embedding usage separately if it occurred
    if (embeddingTokens > 0) {
      await recordAIUsage(db, {
        workspaceId: aiContext.workspaceId,
        agentId: aiContext.agentId,
        conversationId: aiContext.conversationId,
        messageId: aiContext.messageId,
        provider: params.embeddingProvider?.name ?? 'unknown',
        model: knowledgeBase?.embeddingModel ?? 'unknown',
        inputTokens: embeddingTokens,
        outputTokens: 0,
        costMicros: 0,
      });
    }
  } catch (usageErr) {
    logger.error('ai.agent.usage_persistence_failed', {
      workspaceId: aiContext.workspaceId,
      error: usageErr,
    });
  }

  // 11. Update Agent Performance Counters
  try {
    await incrementAgentCounters(db, aiContext.workspaceId, aiContext.agentId, {
      conversationsHandled: 1,
      handoffCount: handoffTriggered ? 1 : 0,
    });
  } catch (counterErr) {
    logger.warn('ai.agent.counter_update_failed', {
      workspaceId: aiContext.workspaceId,
      error: counterErr,
    });
  }

  return {
    turnId: turnRecord?.id ?? '',
    executionId: aiContext.executionId,
    workspaceId: aiContext.workspaceId,
    conversationId: aiContext.conversationId,
    messageId: aiContext.messageId,
    agentId: aiContext.agentId,
    replyText,
    status,
    handoffTriggered,
    handoffReason,
    toolCalls: recordedToolCalls,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    latencyMs,
    costMicros,
    errorMessage,
    errorCategory,
  };
}
