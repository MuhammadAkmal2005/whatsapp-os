/**
 * AI Execution Context.
 *
 * Provides a trusted, server-derived execution context for an AI Agent Turn.
 * Contains only properties validated and authorized server-side.
 *
 * CRITICAL SAFETY:
 * The AI model and model-generated tool arguments MUST NEVER choose, supply,
 * or override `workspaceId`, `agentId`, `conversationId`, `executionId`, or `capabilities`.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';
import { DEFAULT_CURRENCY, type SupportedCurrency } from '@/config/constants';
import { ForbiddenError, ValidationError } from '@/server/errors';

export interface AITenantContext {
  /** The tenant boundary. All tool database operations are locked to this ID. */
  readonly workspaceId: string;
  /** The specific AIAgent executing this turn. */
  readonly agentId: string;
  /** The conversation thread ID being answered. */
  readonly conversationId: string;
  /** The inbound message ID triggering this execution (idempotency anchor). */
  readonly messageId: string;
  /** Unique ID for this specific execution attempt (runtime attempt identifier). */
  readonly executionId: string;
  /** Static set of capabilities granted to this AI agent run. */
  readonly capabilities: ReadonlySet<string>;
  /** Workspace default currency for tool evaluations. */
  readonly currency: SupportedCurrency;
  /** Customer/conversation locale or language. */
  readonly language?: string;
}

export type CreateAIContextParams = {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  messageId: string;
  executionId?: string;
  capabilities: Iterable<string>;
  /**
   * The workspace's own currency, which the runtime reads from the `Workspace` row.
   *
   * Optional only so that callers with no workspace loaded — tests, and tools that
   * quote nothing — can omit it. Omitting it is not a way to pick a currency: it
   * falls back to the platform default, and a workspace that trades in AED and is
   * quoted in rupees is a wrong answer, not a formatting quirk. Pass it.
   */
  currency?: SupportedCurrency;
  language?: string;
};

/**
 * Constructs a trusted AITenantContext on the server.
 */
export function createAITenantContext(params: CreateAIContextParams): AITenantContext {
  if (!params.workspaceId || typeof params.workspaceId !== 'string') {
    throw new ValidationError('AITenantContext requires a valid workspaceId');
  }
  if (!params.agentId || typeof params.agentId !== 'string') {
    throw new ValidationError('AITenantContext requires a valid agentId');
  }
  if (!params.conversationId || typeof params.conversationId !== 'string') {
    throw new ValidationError('AITenantContext requires a valid conversationId');
  }
  if (!params.messageId || typeof params.messageId !== 'string') {
    throw new ValidationError('AITenantContext requires a valid messageId');
  }

  const executionId = params.executionId ?? randomUUID();
  const capabilities = new Set<string>(params.capabilities);
  const currency: SupportedCurrency = params.currency ?? DEFAULT_CURRENCY;

  return {
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    executionId,
    capabilities,
    currency,
    language: params.language,
  };
}

/**
 * Asserts that the AI execution context possesses a required capability.
 */
export function requireAICapability(ctx: AITenantContext, capability: string): void {
  if (!ctx.capabilities.has(capability)) {
    throw new ForbiddenError(
      `AI Agent lacks required capability: ${capability}`,
    );
  }
}
