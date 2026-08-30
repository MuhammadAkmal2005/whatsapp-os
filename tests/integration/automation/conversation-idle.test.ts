/**
 * Conversation Idle Scanning Integration Tests.
 *
 * Verifies that the conversation idle scanner detects inactive conversations,
 * triggers configured automations, and deduplicates repeated scans.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/db/prisma';
import { createAutomation } from '@/server/repositories/automation.repository';
import { scanAndTriggerIdleConversations } from '@/server/services/automation/conversation-idle.service';

async function createTestWorkspace(name: string) {
  const user = await prisma.user.create({
    data: {
      email: `idle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
      passwordHash: 'dummy-hash',
      name: `User ${name}`,
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug: `ws-idle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      members: {
        create: {
          userId: user.id,
          role: 'OWNER',
        },
      },
    },
    include: {
      members: true,
    },
  });

  return {
    workspaceId: workspace.id,
    userId: user.id,
    membershipId: workspace.members[0]!.id,
  };
}

describe('Conversation Idle Scanning Integration Tests (Phase 6 Unit 2)', () => {
  it('detects idle conversations, triggers CONVERSATION_IDLE automation, and prevents duplicate executions', async () => {
    const ws = await createTestWorkspace('Idle Test Workspace');

    // 1. Create 3 contacts & conversations:
    // Conv 1: Idle (2 hours ago) -> Should trigger
    // Conv 2: Active (5 minutes ago) -> Should NOT trigger
    // Conv 3: Resolved (2 hours ago) -> Should NOT trigger

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const contact1 = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        phoneE164: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        name: 'Idle Customer',
      },
    });

    const conv1 = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact1.id,
        status: 'OPEN',
        lastMessageAt: twoHoursAgo,
        lastInboundAt: twoHoursAgo,
      },
    });

    const contact2 = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        phoneE164: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        name: 'Active Customer',
      },
    });

    const conv2 = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact2.id,
        status: 'OPEN',
        lastMessageAt: fiveMinutesAgo,
        lastInboundAt: fiveMinutesAgo,
      },
    });

    const contact3 = await prisma.contact.create({
      data: {
        workspaceId: ws.workspaceId,
        phoneE164: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        name: 'Resolved Customer',
      },
    });

    const conv3 = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact3.id,
        status: 'RESOLVED',
        lastMessageAt: twoHoursAgo,
      },
    });

    // 2. Create CONVERSATION_IDLE automation with SEND_MESSAGE and NOTIFY_TEAM
    const automation = await createAutomation(prisma, ws.workspaceId, {
      name: 'Idle Follow-up Workflow',
      isActive: true,
      triggerType: 'CONVERSATION_IDLE',
      triggerConfig: {
        idleMinutes: 60,
      },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Are you still interested in our products?' },
        },
        {
          position: 1,
          type: 'NOTIFY_TEAM',
          config: {
            title: 'Idle Followup Triggered',
            body: 'Followed up with idle conversation',
            level: 'INFO',
          },
        },
      ],
    });

    // 3. Run idle scan
    const scanResult1 = await scanAndTriggerIdleConversations(
      prisma,
      ws.workspaceId,
      60,
    );

    expect(scanResult1.conversationsScanned).toBe(1);
    expect(scanResult1.automationsTriggered).toBe(1);

    // 4. Verify Conv 1 received message and Conv 2 & 3 did not
    const conv1Messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv1.id },
    });
    expect(conv1Messages).toHaveLength(1);
    expect(conv1Messages[0]!.body).toBe('Are you still interested in our products?');

    const conv2Messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv2.id },
    });
    expect(conv2Messages).toHaveLength(0);

    const conv3Messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv3.id },
    });
    expect(conv3Messages).toHaveLength(0);

    // 5. Verify Notification created
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId, title: 'Idle Followup Triggered' },
    });
    expect(notifications).toHaveLength(1);

    // 6. Verify AutomationRun recorded
    const runs = await prisma.automationRun.findMany({
      where: { workspaceId: ws.workspaceId, automationId: automation.id },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('COMPLETED');

    // 7. Run scan again immediately — conversation is no longer idle because outbound message updated lastMessageAt
    const scanResult2 = await scanAndTriggerIdleConversations(
      prisma,
      ws.workspaceId,
      60,
    );

    expect(scanResult2.conversationsScanned).toBe(0);
    expect(scanResult2.automationsTriggered).toBe(0);
    const conv1MessagesAfter = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv1.id },
    });
    expect(conv1MessagesAfter).toHaveLength(1); // Still exactly 1 message
  });
});
