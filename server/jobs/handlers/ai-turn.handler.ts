/**
 * `ai.respond` job handler.
 *
 * Runs the agent over a conversation that has a new inbound message, then puts the
 * answer in front of the customer. The handler stays thin — the runtime owns the
 * turn, the delivery service owns the message — so this file is only about the two
 * decisions that belong to the job: which provider to run with, and whether the
 * result is something a customer should see.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/server/errors';
import { findAITurnByMessageId } from '@/server/repositories/ai-turn.repository';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { getAIProvider } from '@/server/services/agent/provider.factory';
import { deliverAgentReply } from '@/server/services/agent/reply-delivery.service';
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

  // A retry must not re-run the model. `AITurn.messageId` is unique, so a second
  // `executeAgentTurn` for the same inbound message would spend the tokens and
  // then die on the constraint — and if the first attempt failed *after* the turn
  // committed, the thing that actually needs another go is delivery. So resume
  // there instead.
  const existingTurn = await findAITurnByMessageId(prisma, payload.workspaceId, payload.messageId);

  if (existingTurn) {
    if (existingTurn.outputText && !existingTurn.handoffTriggered) {
      const resumed = await deliverAgentReply(
        { workspaceId: payload.workspaceId },
        {
          conversationId: payload.conversationId,
          turnId: existingTurn.id,
          agentId: existingTurn.agentId,
          replyText: existingTurn.outputText,
        },
      );

      logger.info('ai.job.resumed_delivery', {
        jobId: context.jobId,
        workspaceId: payload.workspaceId,
        turnId: existingTurn.id,
        delivered: resumed.delivered,
        reason: resumed.delivered ? undefined : resumed.reason,
      });
      return;
    }

    logger.info('ai.job.already_processed', {
      jobId: context.jobId,
      workspaceId: payload.workspaceId,
      conversationId: payload.conversationId,
      turnId: existingTurn.id,
      handoffTriggered: existingTurn.handoffTriggered,
    });
    return;
  }

  // Resolved from configuration, never constructed here: `AI_PROVIDER=mock` gets
  // the deterministic mock, a configured deployment gets the real client.
  const provider = getAIProvider();

  const result = await executeAgentTurn({
    db: prisma,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    provider,
  });

  // Only a completed turn speaks. Every handoff and abort path in the runtime
  // already nulls `replyText`, so the status and handoff checks are a second
  // layer — kept because the failure they prevent is the AI talking over a human
  // who has just taken the conversation, and that is not a failure worth one
  // guard.
  const deliverable =
    result.status === 'COMPLETED' &&
    !result.handoffTriggered &&
    typeof result.replyText === 'string' &&
    result.replyText.trim().length > 0;

  if (deliverable) {
    // The turn id is the delivery idempotency key. An empty one means telemetry
    // failed to persist, which leaves nothing to dedupe a retry against — and
    // because no turn row exists, a retry re-runs the model cleanly. Failing the
    // job is therefore the recoverable choice; delivering blind is not.
    if (!result.turnId) {
      throw new Error('AI turn telemetry did not persist; retrying rather than delivering blind');
    }

    const delivery = await deliverAgentReply(
      { workspaceId: payload.workspaceId },
      {
        conversationId: payload.conversationId,
        turnId: result.turnId,
        agentId: result.agentId,
        replyText: result.replyText as string,
      },
    );

    if (!delivery.delivered) {
      logger.warn('ai.job.reply_not_delivered', {
        jobId: context.jobId,
        workspaceId: payload.workspaceId,
        conversationId: payload.conversationId,
        turnId: result.turnId,
        reason: delivery.reason,
      });
    }
  } else if (result.status === 'FAILED') {
    // Surfaced at warn rather than swallowed: a turn that produces no answer is
    // invisible in the queue otherwise, and "the AI went quiet" is the hardest
    // class of bug to hear about from a customer instead of a log.
    logger.warn('ai.job.turn_failed', {
      jobId: context.jobId,
      workspaceId: payload.workspaceId,
      conversationId: payload.conversationId,
      errorCategory: result.errorCategory,
      errorMessage: result.errorMessage,
    });
  }

  logger.info('ai.job.completed', {
    jobId: context.jobId,
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    status: result.status,
    handoffTriggered: result.handoffTriggered,
    delivered: deliverable,
    provider: provider.name,
    latencyMs: result.latencyMs,
  });
};
