/**
 * Automation Engine Execution & Workflow Integration Tests.
 *
 * Verifies end-to-end execution of automation triggers, action sequences,
 * wait-then-act delayed workflows, idempotency, and state transitions.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import {
  createAutomation,
} from '@/server/repositories/automation.repository';
import {
  resumeAutomation,
  triggerAutomations,
} from '@/server/services/automation/automation-engine.service';
import {
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
  type WorkspaceFixture,
} from '../fixtures';

async function createConversationFixture(
  workspaceId: string,
  contactId: string,
  overrides: {
    status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    aiEnabled?: boolean;
  } = {},
) {
  return prisma.conversation.create({
    data: {
      workspaceId,
      contactId,
      channel: 'WHATSAPP',
      status: overrides.status ?? 'OPEN',
      priority: overrides.priority ?? 'NORMAL',
      aiEnabled: overrides.aiEnabled ?? true,
    },
  });
}

describe('Automation Engine Execution Integration Tests', () => {
  let ws: WorkspaceFixture;

  beforeEach(async () => {
    await resetDatabase();
    ws = await createWorkspaceFixture({ name: 'Automation Run Workspace' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. executes multi-action workflow on MESSAGE_CONTAINS trigger', async () => {
    const contact = await createContactFixture(ws.workspaceId, { name: 'Ali Khan', phoneE164: '+923001234567' });
    const conv = await createConversationFixture(ws.workspaceId, contact.id, { status: 'OPEN', priority: 'NORMAL' });

    // Setup active automation
    const auto = await createAutomation(prisma, ws.workspaceId, {
      name: 'Keyword VIP Escalation',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: {
        keywords: ['urgent', 'refund', 'manager'],
        matchMode: 'ANY',
      },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'We have received your urgent request and assigned a manager.' },
        },
        {
          position: 1,
          type: 'SET_PRIORITY',
          config: { priority: 'URGENT' },
        },
        {
          position: 2,
          type: 'ADD_TAG',
          config: { tags: ['escalated', 'vip'] },
        },
        {
          position: 3,
          type: 'NOTIFY_TEAM',
          config: { title: 'VIP Escalation Triggered', level: 'WARNING' },
        },
      ],
    });

    const event = {
      triggerType: 'MESSAGE_CONTAINS' as const,
      subjectType: 'Conversation',
      subjectId: conv.id,
      eventKey: 'msg_001',
      data: { body: 'This is urgent, please help!' },
    };

    const results = await triggerAutomations(prisma, ws.workspaceId, event);

    expect(results.length).toBe(1);
    expect(results[0]?.status).toBe('COMPLETED');

    // 1. Verify outbound message was created
    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv.id, direction: 'OUTBOUND' },
    });
    expect(messages.length).toBe(1);
    expect(messages[0]?.body).toContain('urgent request');

    // 2. Verify priority updated
    const updatedConv = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(updatedConv?.priority).toBe('URGENT');

    // 3. Verify tag added to contact
    const contactTags = await prisma.contactTag.findMany({
      where: { contactId: contact.id },
      include: { tag: true },
    });
    const tagNames = contactTags.map((ct) => ct.tag.name);
    expect(tagNames).toContain('escalated');
    expect(tagNames).toContain('vip');

    // 4. Verify notification created
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId },
    });
    expect(notifications.length).toBe(1);
    expect(notifications[0]?.title).toBe('VIP Escalation Triggered');

    // 5. Verify AutomationRun recorded
    const runs = await prisma.automationRun.findMany({
      where: { workspaceId: ws.workspaceId, automationId: auto.id },
    });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe('COMPLETED');
    expect(runs[0]?.finishedAt).toBeDefined();

    // 6. Verify run count incremented
    const updatedAuto = await prisma.automation.findUnique({ where: { id: auto.id } });
    expect(updatedAuto?.runCount).toBe(1);
  });

  it('2. guarantees idempotent execution (deduplication prevents double-runs)', async () => {
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationFixture(ws.workspaceId, contact.id);

    await createAutomation(prisma, ws.workspaceId, {
      name: 'Single Run Automation',
      isActive: true,
      triggerType: 'MESSAGE_RECEIVED',
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Thanks for messaging!' },
        },
      ],
    });

    const event = {
      triggerType: 'MESSAGE_RECEIVED' as const,
      subjectType: 'Conversation',
      subjectId: conv.id,
      eventKey: 'unique_msg_id_100',
      data: { body: 'Hello' },
    };

    // First trigger
    const res1 = await triggerAutomations(prisma, ws.workspaceId, event);
    expect(res1.length).toBe(1);
    expect(res1[0]?.status).toBe('COMPLETED');

    // Second trigger with exact same eventKey
    const res2 = await triggerAutomations(prisma, ws.workspaceId, event);
    expect(res2.length).toBe(1);
    expect(res2[0]?.status).toBe('COMPLETED');

    // Only 1 outbound message was created
    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv.id, direction: 'OUTBOUND' },
    });
    expect(messages.length).toBe(1);

    // Only 1 run recorded
    const runs = await prisma.automationRun.findMany({
      where: { workspaceId: ws.workspaceId },
    });
    expect(runs.length).toBe(1);
  });

  it('3. executes wait-then-act automation with delayed job resumption', async () => {
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationFixture(ws.workspaceId, contact.id, { aiEnabled: true });

    // Automation: Send msg -> Wait 10m -> Pause AI -> Send follow-up
    const auto = await createAutomation(prisma, ws.workspaceId, {
      name: 'Wait Then Act Flow',
      isActive: true,
      triggerType: 'MESSAGE_RECEIVED',
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Step 1: Immediate acknowledgement' },
        },
        {
          position: 1,
          type: 'WAIT',
          config: { durationMinutes: 10 },
        },
        {
          position: 2,
          type: 'PAUSE_AI',
          config: { reason: 'OUTSIDE_BUSINESS_HOURS' },
        },
        {
          position: 3,
          type: 'SEND_MESSAGE',
          config: { body: 'Step 3: Post-wait delayed message' },
        },
      ],
    });

    const event = {
      triggerType: 'MESSAGE_RECEIVED' as const,
      subjectType: 'Conversation',
      subjectId: conv.id,
      eventKey: 'wait_flow_msg_1',
      data: { body: 'Start wait flow' },
    };

    // Trigger workflow
    const results = await triggerAutomations(prisma, ws.workspaceId, event);
    expect(results.length).toBe(1);
    expect(results[0]?.status).toBe('WAITING');

    // Step 0 executed
    const msgStep1 = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv.id, direction: 'OUTBOUND' },
    });
    expect(msgStep1.length).toBe(1);
    expect(msgStep1[0]?.body).toContain('Step 1');

    // AutomationRun is in WAITING state at action position 2
    const run = await prisma.automationRun.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, automationId: auto.id },
    });
    expect(run.status).toBe('WAITING');
    expect(run.currentActionPosition).toBe(2);

    // Verify delayed job was enqueued in job table
    const jobs = await prisma.job.findMany({
      where: { workspaceId: ws.workspaceId, type: 'automation.resume' },
    });
    expect(jobs.length).toBe(1);
    expect((jobs[0]?.payload as any).runId).toBe(run.id);
    expect((jobs[0]?.payload as any).actionIndex).toBe(2);

    // AI is still enabled before resume
    const convBeforeResume = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(convBeforeResume?.aiEnabled).toBe(true);

    // Simulate worker resuming the job at actionIndex = 2
    const resumeResult = await resumeAutomation(prisma, ws.workspaceId, run.id, 2);
    expect(resumeResult.status).toBe('COMPLETED');

    // Step 2 (PAUSE_AI) executed
    const convAfterResume = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(convAfterResume?.aiEnabled).toBe(false);
    expect(convAfterResume?.handoffReason).toBe('OUTSIDE_BUSINESS_HOURS');

    // Step 3 (Post-wait message) executed
    const allOutbound = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv.id, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'asc' },
    });
    expect(allOutbound.length).toBe(2);
    expect(allOutbound[1]?.body).toContain('Step 3');

    // AutomationRun is now COMPLETED
    const finalRun = await prisma.automationRun.findUnique({ where: { id: run.id } });
    expect(finalRun?.status).toBe('COMPLETED');
    expect(finalRun?.finishedAt).toBeDefined();
  });

  it('4. ignores inactive automations', async () => {
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationFixture(ws.workspaceId, contact.id);

    await createAutomation(prisma, ws.workspaceId, {
      name: 'Inactive Automation',
      isActive: false,
      triggerType: 'MESSAGE_RECEIVED',
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Should not send' },
        },
      ],
    });

    const event = {
      triggerType: 'MESSAGE_RECEIVED' as const,
      subjectType: 'Conversation',
      subjectId: conv.id,
      eventKey: 'inactive_test',
      data: { body: 'Hello' },
    };

    const results = await triggerAutomations(prisma, ws.workspaceId, event);
    expect(results.length).toBe(0);

    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conv.id, direction: 'OUTBOUND' },
    });
    expect(messages.length).toBe(0);
  });
});
