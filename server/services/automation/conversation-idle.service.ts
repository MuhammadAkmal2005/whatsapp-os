/**
 * Conversation Idle Scanner Service.
 *
 * Periodic or on-demand service that scans for idle conversations across
 * workspaces and triggers active CONVERSATION_IDLE automations.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { findActiveAutomationsByTrigger } from '@/server/repositories/automation.repository';
import { triggerAutomations } from './automation-engine.service';

export interface IdleScanResult {
  conversationsScanned: number;
  automationsTriggered: number;
}

/**
 * Scans open/pending conversations that have been idle past configured thresholds
 * and executes matching CONVERSATION_IDLE automations.
 */
export async function scanAndTriggerIdleConversations(
  db: Db = prisma,
  workspaceId?: string,
  defaultIdleMinutes: number = 60,
): Promise<IdleScanResult> {
  const whereWorkspace = workspaceId ? { workspaceId } : {};

  // 1. Fetch active CONVERSATION_IDLE automations
  const activeIdleAutomations = await db.automation.findMany({
    where: {
      ...whereWorkspace,
      isActive: true,
      triggerType: 'CONVERSATION_IDLE',
    },
    include: {
      actions: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (activeIdleAutomations.length === 0) {
    return { conversationsScanned: 0, automationsTriggered: 0 };
  }

  let totalScanned = 0;
  let totalTriggered = 0;

  for (const automation of activeIdleAutomations) {
    const config = (automation.triggerConfig ?? {}) as Record<string, unknown>;
    const idleMinutes = typeof config.idleMinutes === 'number'
      ? config.idleMinutes
      : defaultIdleMinutes;

    const cutoffTime = new Date(Date.now() - idleMinutes * 60 * 1000);

    // Find conversations in this workspace with no activity since cutoffTime
    const idleConversations = await db.conversation.findMany({
      where: {
        workspaceId: automation.workspaceId,
        status: { in: ['OPEN', 'PENDING'] },
        lastMessageAt: {
          lte: cutoffTime,
        },
      },
      take: 50,
      orderBy: { lastMessageAt: 'asc' },
    });

    totalScanned += idleConversations.length;

    for (const conv of idleConversations) {
      const lastMsgTimestamp = conv.lastMessageAt ? conv.lastMessageAt.getTime() : 0;
      const eventKey = `idle:${lastMsgTimestamp}`;

      const actualIdleMinutes = conv.lastMessageAt
        ? Math.floor((Date.now() - conv.lastMessageAt.getTime()) / (1000 * 60))
        : idleMinutes;

      const runs = await triggerAutomations(db, automation.workspaceId, {
        triggerType: 'CONVERSATION_IDLE',
        subjectType: 'Conversation',
        subjectId: conv.id,
        eventKey,
        data: {
          conversationId: conv.id,
          contactId: conv.contactId,
          idleMinutes: actualIdleMinutes,
        },
      });

      totalTriggered += runs.length;
    }
  }

  logger.info('automation.idle_conversations_scanned', {
    workspaceId: workspaceId ?? 'all',
    conversationsScanned: totalScanned,
    automationsTriggered: totalTriggered,
  });

  return {
    conversationsScanned: totalScanned,
    automationsTriggered: totalTriggered,
  };
}
