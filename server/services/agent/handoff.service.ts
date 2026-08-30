import 'server-only';
import { type Db } from '@/db/prisma';
import { type HandoffReason } from '@prisma/client';
import { appendAuditLog } from '@/server/repositories/audit.repository';

export async function triggerHumanHandoff(
  db: Db,
  workspaceId: string,
  conversationId: string,
  reason: HandoffReason,
  triggeredByAi: boolean,
): Promise<void> {
  const run = async (tx: Db) => {
    const conv = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { aiEnabled: true, handoffAt: true, assignedToMemberId: true, workspaceId: true }
    });

    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    if (conv.workspaceId !== workspaceId) {
       throw new Error(`Workspace mismatch`);
    }

    // Idempotency: if already handed off, do nothing safely.
    if (!conv.aiEnabled && conv.handoffAt) {
      return;
    }

    // Atomically transition
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        aiEnabled: false,
        aiPausedAt: new Date(),
        handoffReason: reason,
        handoffAt: new Date(),
      }
    });

    // Notify human
    await tx.notification.create({
      data: {
        workspaceId,
        memberId: conv.assignedToMemberId, // Notify assignee if present, else null = everyone
        type: 'HUMAN_HANDOFF',
        level: 'WARNING',
        title: 'Conversation Handoff',
        body: `Conversation transferred to human control. Reason: ${reason}`,
        resourceType: 'Conversation',
        resourceId: conversationId,
      }
    });

    // Audit log
    await appendAuditLog(tx, {
      workspaceId,
      actorType: triggeredByAi ? 'AI_AGENT' : 'SYSTEM',
      action: 'CONVERSATION_HANDOFF',
      resourceType: 'Conversation',
      resourceId: conversationId,
      metadata: { reason }
    });
  };

  if ('$transaction' in db) {
    await db.$transaction(run);
  } else {
    await run(db);
  }
}
