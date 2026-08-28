/**
 * AI Error Taxonomy & Retry Classification.
 *
 * Distinguishes retryable transient failures from non-retryable authorization,
 * safety, or indeterminate write failures.
 */

import { AppError, BusinessRuleError, ForbiddenError, RateLimitError, ValidationError } from '@/server/errors';

export type AIErrorCategory =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'RATE_LIMITED'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_TOOL_ARGUMENTS'
  | 'AUTHORIZATION_FAILURE'
  | 'TOOL_EXECUTION_FAILURE'
  | 'BUSINESS_RULE_REJECTION'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'HUMAN_TAKEOVER'
  | 'UNKNOWN_WRITE_OUTCOME'
  | 'SAFETY_POLICY_VIOLATION';

export type AIRetryability =
  | 'RETRYABLE'
  | 'NOT_RETRYABLE'
  | 'REQUIRES_MANUAL_REVIEW';

export interface AIErrorClassification {
  category: AIErrorCategory;
  retryability: AIRetryability;
  message: string;
}

export class AIAgentError extends AppError {
  readonly code = 'AI_AGENT_ERROR';
  readonly status = 500;
  readonly category: AIErrorCategory;
  readonly retryability: AIRetryability;
  readonly toolName?: string;
  readonly executionId?: string;

  constructor(
    message: string,
    options: {
      category: AIErrorCategory;
      retryability: AIRetryability;
      toolName?: string;
      executionId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.category = options.category;
    this.retryability = options.retryability;
    this.toolName = options.toolName;
    this.executionId = options.executionId;
  }
}

/**
 * Classifies an arbitrary error into normalized AI error categories and retry policies.
 */
export function classifyAIError(error: unknown): AIErrorClassification {
  if (error instanceof AIAgentError) {
    return {
      category: error.category,
      retryability: error.retryability,
      message: error.message,
    };
  }

  if (error instanceof ForbiddenError) {
    return {
      category: 'AUTHORIZATION_FAILURE',
      retryability: 'NOT_RETRYABLE',
      message: error.message,
    };
  }

  if (error instanceof ValidationError) {
    return {
      category: 'INVALID_TOOL_ARGUMENTS',
      retryability: 'NOT_RETRYABLE',
      message: error.message,
    };
  }

  if (error instanceof BusinessRuleError) {
    return {
      category: 'BUSINESS_RULE_REJECTION',
      retryability: 'NOT_RETRYABLE',
      message: error.message,
    };
  }

  if (error instanceof RateLimitError) {
    return {
      category: 'RATE_LIMITED',
      retryability: 'RETRYABLE',
      message: error.message,
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
      return {
        category: 'PROVIDER_TIMEOUT',
        retryability: 'RETRYABLE',
        message: error.message,
      };
    }

    if (
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('network')
    ) {
      return {
        category: 'PROVIDER_UNAVAILABLE',
        retryability: 'RETRYABLE',
        message: error.message,
      };
    }

    return {
      category: 'TOOL_EXECUTION_FAILURE',
      retryability: 'NOT_RETRYABLE',
      message: error.message,
    };
  }

  return {
    category: 'TOOL_EXECUTION_FAILURE',
    retryability: 'NOT_RETRYABLE',
    message: 'Unknown error occurred during AI execution',
  };
}
