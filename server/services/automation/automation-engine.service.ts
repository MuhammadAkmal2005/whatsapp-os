/**
 * Automation Engine Service.
 *
 * Evaluates triggers, orchestrates multi-step actions, handles
 * wait-then-act resumption via background jobs, and ensures idempotent
 * execution across all workspace automations.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { queue } from '@/server/jobs';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  createAutomationRun,
  findActiveAutomationsByTrigger,
  findAutomationRunByDedupeKey,
  findAutomationRunById,
  incrementAutomationRunCount,
  updateAutomationRun,
} from '@/server/repositories/automation.repository';
import { createNotification } from '@/server/repositories/notification.repository';
import type {
  ActionType,
  Automation,
  AutomationAction,
  AutomationRun,
  ConversationStatus,
  HandoffReason,
  LeadStage,
  NotificationLevel,
  Priority,
  TriggerType,
} from '@prisma/client';
import type { TriggerEvent } from '@/server/validation/automation';

export interface TriggerEvaluationResult {
  matched: boolean;
}

/**
 * Checks whether an event matches an automation's trigger configuration.
 */
export function evaluateTriggerMatch(
  triggerType: TriggerType,
  triggerConfig: unknown,
  eventData: Record<string, unknown> = {},
): boolean {
  if (!triggerConfig || typeof triggerConfig !== 'object') {
    return true; // No filter configured -> match all events of this trigger type
  }

  const config = triggerConfig as Record<string, unknown>;

  switch (triggerType) {
    case 'MESSAGE_CONTAINS': {
      const keywords = Array.isArray(config.keywords) ? (config.keywords as string[]) : [];
      if (keywords.length === 0) return true;

      const body = typeof eventData.body === 'string'
        ? eventData.body
        : typeof eventData.text === 'string'
          ? eventData.text
          : '';

      const matchMode = (config.matchMode as string) || 'ANY';
      const caseSensitive = Boolean(config.caseSensitive);
      const textToSearch = caseSensitive ? body : body.toLowerCase();

      if (matchMode === 'EXACT') {
        return keywords.some((kw) => {
          const target = caseSensitive ? kw : kw.toLowerCase();
          return textToSearch.trim() === target.trim();
        });
      }

      if (matchMode === 'ALL') {
        return keywords.every((kw) => {
          const target = caseSensitive ? kw : kw.toLowerCase();
          return textToSearch.includes(target);
        });
      }

      // Default: ANY
      return keywords.some((kw) => {
        const target = caseSensitive ? kw : kw.toLowerCase();
        return textToSearch.includes(target);
      });
    }

    case 'ORDER_STATUS_CHANGED': {
      if (config.fromStatus && eventData.fromStatus !== config.fromStatus) {
        return false;
      }
      if (config.toStatus && eventData.toStatus !== config.toStatus) {
        return false;
      }
      return true;
    }

    case 'LEAD_STAGE_CHANGED': {
      if (config.fromStage && eventData.fromStage !== config.fromStage) {
        return false;
      }
      if (config.toStage && eventData.toStage !== config.toStage) {
        return false;
      }
      return true;
    }

    case 'LOW_STOCK': {
      const threshold = typeof config.threshold === 'number' ? config.threshold : 5;
      const available = typeof eventData.available === 'number' ? eventData.available : 0;
      return available <= threshold;
    }

    case 'CONVERSATION_IDLE': {
      const idleMinutes = typeof config.idleMinutes === 'number' ? config.idleMinutes : 60;
      const actualIdleMinutes = typeof eventData.idleMinutes === 'number' ? eventData.idleMinutes : 0;
      return actualIdleMinutes >= idleMinutes;
    }

    default:
      return true;
  }
}

/**
 * Triggers all active automations matching a domain event in a workspace.
 */
export async function triggerAutomations(
  db: Db,
  workspaceId: string,
  event: TriggerEvent,
): Promise<Array<{ automationId: string; runId: string; status: string }>> {
  const activeAutomations = await findActiveAutomationsByTrigger(
    db,
    workspaceId,
    event.triggerType,
  );

  if (activeAutomations.length === 0) {
    return [];
  }

  const results: Array<{ automationId: string; runId: string; status: string }> = [];

  for (const automation of activeAutomations) {
    // Check if trigger conditions match
    const isMatch = evaluateTriggerMatch(
      automation.triggerType,
      automation.triggerConfig,
      event.data,
    );

    if (!isMatch) {
      continue;
    }

    // Compute deterministic dedupe key for this run
    const eventKey = event.eventKey || `${Date.now()}`;
    const dedupeKey = `auto:${automation.id}:${event.subjectType}:${event.subjectId}:${eventKey}`;

    // Check if run already exists (idempotency guard)
    const existingRun = await findAutomationRunByDedupeKey(db, dedupeKey);
    if (existingRun) {
      logger.info('automation.run_skipped_duplicate', {
        workspaceId,
        automationId: automation.id,
        dedupeKey,
      });
      results.push({
        automationId: automation.id,
        runId: existingRun.id,
        status: existingRun.status,
      });
      continue;
    }

    // Create new AutomationRun
    const run = await createAutomationRun(db, workspaceId, {
      automationId: automation.id,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      dedupeKey,
      status: 'RUNNING',
      currentActionPosition: 0,
    });

    // Execute actions sequentially
    const execResult = await executeAutomationActions(
      db,
      workspaceId,
      automation,
      run,
      event,
      0,
    );

    results.push({
      automationId: automation.id,
      runId: run.id,
      status: execResult.status,
    });
  }

  return results;
}

/**
 * Executes a sequence of automation actions starting from a specific position.
 */
export async function executeAutomationActions(
  db: Db,
  workspaceId: string,
  automation: Automation & { actions: AutomationAction[] },
  run: AutomationRun,
  event: TriggerEvent,
  startPosition: number = 0,
): Promise<{ status: string; error?: string }> {
  const sortedActions = [...automation.actions].sort(
    (a, b) => a.position - b.position,
  );
  const remainingActions = sortedActions.filter(
    (act) => act.position >= startPosition,
  );

  for (const action of remainingActions) {
    try {
      if (action.type === 'WAIT') {
        const config = (action.config ?? {}) as Record<string, unknown>;
        const durationMinutes = typeof config.durationMinutes === 'number' ? config.durationMinutes : 0;
        const durationSeconds = typeof config.durationSeconds === 'number'
          ? config.durationSeconds
          : durationMinutes * 60;

        const waitMs = Math.max(1, durationSeconds) * 1000;
        const resumePosition = action.position + 1;

        // Transition run to WAITING
        await updateAutomationRun(db, workspaceId, run.id, {
          status: 'WAITING',
          currentActionPosition: resumePosition,
        });

        // Enqueue delayed resume job
        const runAt = new Date(Date.now() + waitMs);
        const resumeDedupeKey = `auto:resume:${run.id}:${resumePosition}`;

        await queue.enqueue(
          'automation.resume',
          {
            workspaceId,
            runId: run.id,
            actionIndex: resumePosition,
          },
          {
            runAt,
            dedupeKey: resumeDedupeKey,
          },
        );

        logger.info('automation.action_waiting', {
          workspaceId,
          automationId: automation.id,
          runId: run.id,
          resumePosition,
          waitMs,
          runAt: runAt.toISOString(),
        });

        return { status: 'WAITING' };
      }

      // Execute single action step
      await executeSingleAction(db, workspaceId, action, event);

      // Advance position
      await updateAutomationRun(db, workspaceId, run.id, {
        currentActionPosition: action.position + 1,
      });
    } catch (err: any) {
      const errorMessage = err?.message || 'Action execution failed';
      logger.error('automation.action_failed', {
        workspaceId,
        automationId: automation.id,
        runId: run.id,
        actionType: action.type,
        position: action.position,
        error: errorMessage,
      });

      await updateAutomationRun(db, workspaceId, run.id, {
        status: 'FAILED',
        error: errorMessage,
        finishedAt: new Date(),
      });

      await appendAuditLog(db, {
        workspaceId,
        actorType: 'AUTOMATION',
        action: 'automation.run_failed',
        resourceType: 'AutomationRun',
        resourceId: run.id,
        metadata: {
          automationId: automation.id,
          actionType: action.type,
          error: errorMessage,
        },
      });

      return { status: 'FAILED', error: errorMessage };
    }
  }

  // All actions completed successfully
  await updateAutomationRun(db, workspaceId, run.id, {
    status: 'COMPLETED',
    finishedAt: new Date(),
  });

  await incrementAutomationRunCount(db, workspaceId, automation.id);

  await appendAuditLog(db, {
    workspaceId,
    actorType: 'AUTOMATION',
    action: 'automation.run_completed',
    resourceType: 'AutomationRun',
    resourceId: run.id,
    metadata: {
      automationId: automation.id,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
    },
  });

  logger.info('automation.run_completed', {
    workspaceId,
    automationId: automation.id,
    runId: run.id,
  });

  return { status: 'COMPLETED' };
}

/**
 * Resumes a waiting automation run from a delayed job.
 */
export async function resumeAutomation(
  db: Db,
  workspaceId: string,
  runId: string,
  actionIndex: number,
): Promise<{ status: string; error?: string }> {
  const run = await findAutomationRunById(db, workspaceId, runId);
  if (!run) {
    logger.warn('automation.resume_run_not_found', { workspaceId, runId });
    return { status: 'FAILED', error: 'Automation run not found' };
  }

  if (run.status !== 'WAITING') {
    logger.info('automation.resume_skipped_not_waiting', {
      workspaceId,
      runId,
      status: run.status,
    });
    return { status: run.status };
  }

  // Set status back to RUNNING
  await updateAutomationRun(db, workspaceId, run.id, {
    status: 'RUNNING',
  });

  const reconstructedEvent: TriggerEvent = {
    triggerType: run.automation.triggerType,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    data: {},
  };

  return executeAutomationActions(
    db,
    workspaceId,
    run.automation,
    run,
    reconstructedEvent,
    actionIndex,
  );
}

/**
 * Executes a single action step against the workspace database and external entities.
 */
async function executeSingleAction(
  db: Db,
  workspaceId: string,
  action: AutomationAction,
  event: TriggerEvent,
): Promise<void> {
  const config = (action.config ?? {}) as Record<string, unknown>;

  switch (action.type) {
    case 'SEND_MESSAGE': {
      const body = typeof config.body === 'string' ? config.body : '';
      if (!body) return;

      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) {
        logger.warn('automation.send_message_no_conversation', {
          workspaceId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
        });
        return;
      }

      await db.message.create({
        data: {
          workspaceId,
          conversationId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body,
          status: 'SENT',
          occurredAt: new Date(),
        },
      });

      // Update conversation lastOutboundAt & messageCount
      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: {
          lastOutboundAt: new Date(),
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
        },
      });
      break;
    }

    case 'SEND_TEMPLATE': {
      const templateName = typeof config.templateName === 'string' ? config.templateName : '';
      if (!templateName) return;

      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      await db.message.create({
        data: {
          workspaceId,
          conversationId,
          direction: 'OUTBOUND',
          type: 'TEMPLATE',
          body: `Template: ${templateName}`,
          status: 'SENT',
          occurredAt: new Date(),
        },
      });
      break;
    }

    case 'ADD_TAG': {
      const tagsToAdd = Array.isArray(config.tags)
        ? (config.tags as string[])
        : typeof config.tag === 'string'
          ? [config.tag]
          : [];

      if (tagsToAdd.length === 0) return;

      const contactId = await resolveContactId(db, workspaceId, event);
      if (!contactId) return;

      for (const tagName of tagsToAdd) {
        const tag = await db.tag.upsert({
          where: {
            workspaceId_name: { workspaceId, name: tagName },
          },
          create: {
            workspaceId,
            name: tagName,
          },
          update: {},
        });

        await db.contactTag.upsert({
          where: {
            contactId_tagId: { contactId, tagId: tag.id },
          },
          create: {
            contactId,
            tagId: tag.id,
          },
          update: {},
        });
      }
      break;
    }

    case 'REMOVE_TAG': {
      const tagsToRemove = Array.isArray(config.tags)
        ? (config.tags as string[])
        : typeof config.tag === 'string'
          ? [config.tag]
          : [];

      if (tagsToRemove.length === 0) return;

      const contactId = await resolveContactId(db, workspaceId, event);
      if (!contactId) return;

      for (const tagName of tagsToRemove) {
        const tag = await db.tag.findUnique({
          where: {
            workspaceId_name: { workspaceId, name: tagName },
          },
        });

        if (tag) {
          await db.contactTag.deleteMany({
            where: {
              contactId,
              tagId: tag.id,
            },
          });
        }
      }
      break;
    }

    case 'ASSIGN_CONVERSATION': {
      const memberId = typeof config.memberId === 'string' ? config.memberId : null;
      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: { assignedToMemberId: memberId },
      });
      break;
    }

    case 'SET_CONVERSATION_STATUS': {
      const status = config.status as ConversationStatus;
      if (!status) return;

      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: {
          status,
          ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
          ...(status === 'CLOSED' ? { closedAt: new Date() } : {}),
        },
      });
      break;
    }

    case 'SET_PRIORITY': {
      const priority = config.priority as Priority;
      if (!priority) return;

      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: { priority },
      });
      break;
    }

    case 'SET_LEAD_STAGE': {
      const stage = typeof config.stage === 'string' ? (config.stage as LeadStage) : null;
      if (!stage) return;

      const contactId = await resolveContactId(db, workspaceId, event);
      if (!contactId) return;

      await db.contact.updateMany({
        where: { id: contactId, workspaceId },
        data: { leadStage: stage },
      });
      break;
    }

    case 'PAUSE_AI': {
      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      const reason = (config.reason as HandoffReason) || 'MANUAL_TAKEOVER';

      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: {
          aiEnabled: false,
          aiPausedAt: new Date(),
          handoffReason: reason,
          handoffAt: new Date(),
        },
      });
      break;
    }

    case 'RESUME_AI': {
      const conversationId = await resolveConversationId(db, workspaceId, event);
      if (!conversationId) return;

      await db.conversation.updateMany({
        where: { id: conversationId, workspaceId },
        data: {
          aiEnabled: true,
          aiPausedAt: null,
          aiPausedByMemberId: null,
          handoffReason: null,
          handoffAt: null,
        },
      });
      break;
    }

    case 'NOTIFY_TEAM': {
      const title = typeof config.title === 'string' ? config.title : 'Automation Alert';
      const body = typeof config.body === 'string' ? config.body : null;
      const level = (config.level as NotificationLevel) || 'INFO';
      const memberId = typeof config.memberId === 'string' ? config.memberId : null;

      await createNotification(db, workspaceId, {
        memberId,
        type: 'HUMAN_HANDOFF',
        level,
        title,
        body,
        resourceType: event.subjectType,
        resourceId: event.subjectId,
      });
      break;
    }

    case 'CREATE_NOTE': {
      const content = typeof config.content === 'string' ? config.content : '';
      if (!content) return;

      await appendAuditLog(db, {
        workspaceId,
        actorType: 'AUTOMATION',
        action: 'automation.note_created',
        resourceType: event.subjectType,
        resourceId: event.subjectId,
        metadata: { content },
      });
      break;
    }

    default:
      logger.warn('automation.unknown_action_type', {
        workspaceId,
        actionType: (action as any).type,
      });
  }
}

/**
 * Resolves a conversation ID from the trigger event subject.
 */
async function resolveConversationId(
  db: Db,
  workspaceId: string,
  event: TriggerEvent,
): Promise<string | null> {
  if (event.subjectType === 'Conversation') {
    return event.subjectId;
  }

  if (event.subjectType === 'Contact') {
    const active = await db.conversation.findFirst({
      where: {
        workspaceId,
        contactId: event.subjectId,
        status: { in: ['OPEN', 'PENDING'] },
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    return active?.id ?? null;
  }

  if (event.subjectType === 'Order') {
    const order = await db.order.findFirst({
      where: { id: event.subjectId, workspaceId },
      select: { contactId: true },
    });
    if (order?.contactId) {
      const active = await db.conversation.findFirst({
        where: {
          workspaceId,
          contactId: order.contactId,
          status: { in: ['OPEN', 'PENDING'] },
        },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });
      return active?.id ?? null;
    }
  }

  return null;
}

/**
 * Resolves a contact ID from the trigger event subject.
 */
async function resolveContactId(
  db: Db,
  workspaceId: string,
  event: TriggerEvent,
): Promise<string | null> {
  if (event.subjectType === 'Contact') {
    return event.subjectId;
  }

  if (event.subjectType === 'Conversation') {
    const conv = await db.conversation.findFirst({
      where: { id: event.subjectId, workspaceId },
      select: { contactId: true },
    });
    return conv?.contactId ?? null;
  }

  if (event.subjectType === 'Order') {
    const order = await db.order.findFirst({
      where: { id: event.subjectId, workspaceId },
      select: { contactId: true },
    });
    return order?.contactId ?? null;
  }

  return null;
}
