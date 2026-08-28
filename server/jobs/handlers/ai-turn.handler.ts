/**
 * Background job handler for `ai.respond`.
 *
 * Runs the AI agent runtime over a conversation with a new inbound message.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/server/errors';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import type { JobPayload } from '../job-types';
import type { JobContext, JobHandler } from '../registry';

export const aiRespondHandler: JobHandler<'ai.respond'> = async (
  payload: JobPayload<'ai.respond'>,
  context: JobContext,
): Promise<void> => {
  if (!payload || !payload.workspaceId || !payload.conversationId || !payload.messageId) {
    throw new ValidationError('Invalid payload for ai.respond job');
  }

  logger.info('ai.job.started', {
    jobId: context.jobId,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
  });

  // For Unit 1 foundation, use MockAIProvider by default
  const provider = new MockAIProvider();

  const result = await executeAgentTurn({
    db: prisma,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    provider,
  });

  logger.info('ai.job.completed', {
    jobId: context.jobId,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    status: result.status,
    handoffTriggered: result.handoffTriggered,
    latencyMs: result.latencyMs,
  });
};
