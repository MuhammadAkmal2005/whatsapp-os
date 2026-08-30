import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerHumanHandoff } from '@/server/services/agent/handoff.service';
import { prisma } from '@/db/prisma';
// We will create mock objects directly instead of using DB fixtures since this is a unit test,
// or we can use the integration fixtures if this actually hits the DB.
import { createWorkspaceFixture, createContactFixture } from '../integration/fixtures';

async function createConversationRow(
  workspaceId: string,
  contactId: string,
) {
  return prisma.conversation.create({
    data: {
      workspaceId,
      contactId,
      status: 'OPEN',
      channel: 'WHATSAPP',
    },
  });
}

describe('Human Handoff Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('1. performs atomic handoff transition and creates notification and audit log', async () => {
    const ws = await createWorkspaceFixture();
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationRow(ws.workspaceId, contact.id);

    // Initial state
    let conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(conversation.aiEnabled).toBe(true);

    await triggerHumanHandoff(prisma, ws.workspaceId, conv.id, 'CUSTOMER_REQUESTED', true);

    // Check transition
    conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(conversation.aiEnabled).toBe(false);
    expect(conversation.handoffReason).toBe('CUSTOMER_REQUESTED');
    expect(conversation.handoffAt).toBeDefined();
    
    // Check Notification
    const notifs = await prisma.notification.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(notifs.length).toBe(1);
    expect(notifs[0]?.type).toBe('HUMAN_HANDOFF');
    expect(notifs[0]?.resourceId).toBe(conv.id);

    // Check Audit Log
    const audits = await prisma.auditLog.findMany({ where: { resourceId: conv.id, action: 'CONVERSATION_HANDOFF' } });
    expect(audits.length).toBe(1);
    expect(audits[0]?.actorType).toBe('AI_AGENT');
  });

  it('2. handoff is idempotent and does not create duplicate notifications', async () => {
    const ws = await createWorkspaceFixture();
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationRow(ws.workspaceId, contact.id);

    // First handoff
    await triggerHumanHandoff(prisma, ws.workspaceId, conv.id, 'AI_ERROR', true);
    
    // Second handoff attempt
    await triggerHumanHandoff(prisma, ws.workspaceId, conv.id, 'CUSTOMER_REQUESTED', true);

    const notifs = await prisma.notification.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(notifs.length).toBe(1); // Still 1
    
    const audits = await prisma.auditLog.findMany({ where: { resourceId: conv.id, action: 'CONVERSATION_HANDOFF' } });
    expect(audits.length).toBe(1); // Still 1

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    // Should preserve the original reason
    expect(conversation.handoffReason).toBe('AI_ERROR');
  });
});
