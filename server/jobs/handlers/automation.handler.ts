/**
 * Automation background job handlers.
 *
 * Handles execution of triggered automations and delayed resumption of
 * wait-then-act workflows.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  findAutomationById,
} from '@/server/repositories/automation.repository';
import {
  executeAutomationActions,
  resumeAutomation,
} from '@/server/services/automation/automation-engine.service';
import type { JobContext, JobHandler } from '../registry';

/**
 * Handles 'automation.run' background jobs.
 */
export const automationRunHandler: JobHandler<'automation.run'> = async (
  payload,
  ctx: JobContext,
) => {
  const { workspaceId, automationId, triggerContext } = payload;

  logger.info('automation.job_run_started', {
    jobId: ctx.jobId,
    workspaceId,
    automationId,
  });

  const automation = await findAutomationById(prisma, workspaceId, automationId);
  if (!automation) {
    logger.warn('automation.job_run_automation_not_found', {
      jobId: ctx.jobId,
      workspaceId,
      automationId,
    });
    return;
  }

  if (!automation.isActive) {
    logger.info('automation.job_run_automation_inactive', {
      jobId: ctx.jobId,
      workspaceId,
      automationId,
    });
    return;
  }

  const subjectType = typeof triggerContext.subjectType === 'string'
    ? triggerContext.subjectType
    : 'Unknown';
  const subjectId = typeof triggerContext.subjectId === 'string'
    ? triggerContext.subjectId
    : '00000000-0000-0000-0000-000000000000';

  const dedupeKey = `auto:job:${automationId}:${subjectType}:${subjectId}:${ctx.jobId}`;

  const run = await prisma.automationRun.create({
    data: {
      workspaceId,
      automationId,
      subjectType,
      subjectId,
      dedupeKey,
      status: 'RUNNING',
      currentActionPosition: 0,
      startedAt: new Date(),
    },
  });

  const result = await executeAutomationActions(
    prisma,
    workspaceId,
    automation,
    run,
    {
      triggerType: automation.triggerType,
      subjectType,
      subjectId,
      data: triggerContext,
    },
    0,
  );

  logger.info('automation.job_run_finished', {
    jobId: ctx.jobId,
    workspaceId,
    automationId,
    status: result.status,
  });
};

/**
 * Handles 'automation.resume' background jobs.
 */
export const automationResumeHandler: JobHandler<'automation.resume'> = async (
  payload,
  ctx: JobContext,
) => {
  const { workspaceId, runId, actionIndex } = payload;

  logger.info('automation.job_resume_started', {
    jobId: ctx.jobId,
    workspaceId,
    runId,
    actionIndex,
  });

  const result = await resumeAutomation(prisma, workspaceId, runId, actionIndex);

  logger.info('automation.job_resume_finished', {
    jobId: ctx.jobId,
    workspaceId,
    runId,
    status: result.status,
  });
};

/**
 * Handles 'automation.check_idle' background jobs.
 */
export const automationCheckIdleHandler: JobHandler<'automation.check_idle'> = async (
  payload,
  ctx: JobContext,
) => {
  const { workspaceId, idleMinutes } = payload;

  logger.info('automation.job_check_idle_started', {
    jobId: ctx.jobId,
    workspaceId,
    idleMinutes,
  });

  const { scanAndTriggerIdleConversations } = await import(
    '@/server/services/automation/conversation-idle.service'
  );

  const result = await scanAndTriggerIdleConversations(
    prisma,
    workspaceId,
    idleMinutes ?? 60,
  );

  logger.info('automation.job_check_idle_finished', {
    jobId: ctx.jobId,
    conversationsScanned: result.conversationsScanned,
    automationsTriggered: result.automationsTriggered,
  });
};

