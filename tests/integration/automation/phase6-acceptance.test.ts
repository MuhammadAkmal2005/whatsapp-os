/**
 * Phase 6 Master Acceptance & End-to-End Orchestration Suite.
 *
 * Validates the complete Phase 6 definition of done and exit gates:
 * 1. Human handoff orchestration, AI auto-pause, team notification & auto-assignment
 * 2. Multi-step wait-then-act automation workflow with delayed background job resumption
 * 3. Idempotent execution and duplicate prevention
 * 4. Periodic conversation idle scanner with auto re-engagement
 * 5. Advanced trigger matching (keywords, statuses, lead stages) & action chaining
 * 6. Strict multi-tenant isolation across automations, runs, and notifications
 * 7. RBAC permissions and boundary enforcement
 * 8. Notification center lifecycle (overview, counts, mark read, mark all read)
 * 9. AI safety guardrails and human takeover monotonicity
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db/prisma';
import {
  automationCheckIdleHandler,
  automationResumeHandler,
  automationRunHandler,
} from '@/server/jobs/handlers/automation.handler';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  toggleAutomation,
  updateAutomation,
} from '@/server/services/automation/automation.service';
import {
  evaluateTriggerMatch,
  executeAutomationActions,
  resumeAutomation,
  triggerAutomations,
} from '@/server/services/automation/automation-engine.service';
import { scanAndTriggerIdleConversations } from '@/server/services/automation/conversation-idle.service';
import { triggerHumanHandoff } from '@/server/services/agent/handoff.service';
import {
  createSystemNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/server/services/notification/notification.service';
import {
  createContactFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';
import type { JobContext } from '@/server/jobs/registry';

const createMockJobContext = (jobId: string = 'mock-job-id'): JobContext => ({
  jobId,
  attempt: 1,
  maxAttempts: 3,
  signal: new AbortController().signal,
});

describe('Phase 6 Master Acceptance & End-to-End Orchestration Suite', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Human Handoff & Auto-Pause & Escalation Flow
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 1: Executes end-to-end human handoff, auto-pauses AI, notifies team, and triggers HANDOFF_REQUESTED automation to assign agent', async () => {
    const ws = await createWorkspaceFixture({ name: 'Handoff Workspace' });
    const member = await createMemberFixture(ws.workspaceId, 'AGENT');

    // 1. Create a contact and conversation with AI enabled
    const contact = await createContactFixture(ws.workspaceId, {
      name: 'Bilal Khan',
      phoneE164: '+923001234567',
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        aiEnabled: true,
        priority: 'NORMAL',
      },
    });

    // 2. Set up an automation on HANDOFF_REQUESTED that assigns the conversation and sends acknowledgment
    await createAutomation(ws.context, {
      name: 'Auto-Assign On Handoff',
      isActive: true,
      triggerType: 'HANDOFF_REQUESTED',
      actions: [
        {
          position: 0,
          type: 'ASSIGN_CONVERSATION',
          config: { memberId: member.membershipId },
        },
        {
          position: 1,
          type: 'SET_PRIORITY',
          config: { priority: 'HIGH' },
        },
        {
          position: 2,
          type: 'SEND_MESSAGE',
          config: { body: 'You have been connected to a human specialist. Someone will assist you shortly.' },
        },
      ],
    });

    // 3. Customer turn triggers human handoff
    await triggerHumanHandoff(
      prisma,
      ws.workspaceId,
      conversation.id,
      'CUSTOMER_REQUESTED',
      true,
    );

    // 4. Verify conversation state: AI paused, handoff metadata saved
    const updatedConv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updatedConv.aiEnabled).toBe(false);
    expect(updatedConv.handoffReason).toBe('CUSTOMER_REQUESTED');
    expect(updatedConv.handoffAt).not.toBeNull();
    expect(updatedConv.assignedToMemberId).toBe(member.membershipId);
    expect(updatedConv.priority).toBe('HIGH');

    // 5. Verify team notification created
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId },
    });
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const handoffNotification = notifications.find((n) => n.type === 'HUMAN_HANDOFF');
    expect(handoffNotification).toBeDefined();
    expect(handoffNotification?.title).toBe('Conversation Handoff');

    // 6. Verify automated message was sent
    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conversation.id },
    });
    expect(messages.some((m) => Boolean(m.body && m.body.includes('connected to a human specialist')))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: Wait-Then-Act Multistep Automation Workflow & Resume Idempotency
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 2: Executes wait-then-act automation with delayed job resumption and strict idempotency', async () => {
    const ws = await createWorkspaceFixture({ name: 'Wait Act Workspace' });

    const contact = await createContactFixture(ws.workspaceId, {
      name: 'Ayesha Tariq',
      phoneE164: '+923009876543',
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
      },
    });

    const order = await prisma.order.create({
      data: {
        workspaceId: ws.workspaceId,
        orderNumber: 'ORD-PHASE6-001',
        contactId: contact.id,
        conversationId: conversation.id,
        status: 'PENDING',
        customerName: 'Ayesha Tariq',
        phoneE164: '+923009876543',
        subtotalMinor: 850000,
        totalMinor: 850000,
      },
    });

    // Create 4-step automation: Send confirmation -> Add tag -> Wait 300s -> Update lead stage -> Notify team
    const automation = await createAutomation(ws.context, {
      name: 'Order Confirmation & Delayed VIP Followup',
      isActive: true,
      triggerType: 'ORDER_STATUS_CHANGED',
      triggerConfig: {
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
      },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Your order ORD-PHASE6-001 has been confirmed!' },
        },
        {
          position: 1,
          type: 'ADD_TAG',
          config: { tags: ['order-confirmed', 'vip-customer'] },
        },
        {
          position: 2,
          type: 'WAIT',
          config: { durationSeconds: 300 },
        },
        {
          position: 3,
          type: 'SET_LEAD_STAGE',
          config: { stage: 'CONVERTED' },
        },
        {
          position: 4,
          type: 'NOTIFY_TEAM',
          config: {
            title: 'VIP Order Post-Confirmation',
            body: 'Customer converted via order confirmation workflow.',
            level: 'INFO',
          },
        },
      ],
    });

    // Trigger automation on Order status change
    const triggerResults = await triggerAutomations(prisma, ws.workspaceId, {
      triggerType: 'ORDER_STATUS_CHANGED',
      subjectType: 'Order',
      subjectId: order.id,
      eventKey: `order:${order.id}:confirmed`,
      data: {
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
      },
    });

    expect(triggerResults.length).toBe(1);
    const triggerResult = triggerResults[0]!;
    expect(triggerResult.status).toBe('WAITING');

    // Query the run row to verify WAITING status and action position
    const waitingRun = await prisma.automationRun.findUniqueOrThrow({
      where: { id: triggerResult.runId },
    });
    expect(waitingRun.status).toBe('WAITING');
    expect(waitingRun.currentActionPosition).toBe(3);

    // Verify initial actions executed (Message + Tags)
    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: conversation.id },
    });
    expect(messages.length).toBe(1);
    expect(messages[0]!.body).toContain('ORD-PHASE6-001 has been confirmed');

    const tags = await prisma.contactTag.findMany({
      where: { contactId: contact.id },
      include: { tag: true },
    });
    const tagNames = tags.map((t) => t.tag.name);
    expect(tagNames).toContain('order-confirmed');
    expect(tagNames).toContain('vip-customer');

    // Simulate Background Worker resuming the job via automationResumeHandler
    await automationResumeHandler(
      {
        workspaceId: ws.workspaceId,
        runId: triggerResult.runId,
        actionIndex: 3,
      },
      createMockJobContext('mock-resume-job-id'),
    );

    // Verify post-resume state: Status COMPLETED, Lead Stage CONVERTED, Notification created
    const completedRun = await prisma.automationRun.findUniqueOrThrow({
      where: { id: triggerResult.runId },
    });
    expect(completedRun.status).toBe('COMPLETED');

    const updatedContact = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
    });
    expect(updatedContact.leadStage).toBe('CONVERTED');

    const teamNotifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId, title: 'VIP Order Post-Confirmation' },
    });
    expect(teamNotifications.length).toBe(1);

    // Idempotency check: Re-triggering the exact same event does NOT create a second AutomationRun
    const secondTrigger = await triggerAutomations(prisma, ws.workspaceId, {
      triggerType: 'ORDER_STATUS_CHANGED',
      subjectType: 'Order',
      subjectId: order.id,
      eventKey: `order:${order.id}:confirmed`,
      data: {
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
      },
    });
    expect(secondTrigger.length).toBe(1);
    expect(secondTrigger[0]!.runId).toBe(triggerResult.runId);

    const allRuns = await prisma.automationRun.findMany({
      where: { automationId: automation.id },
    });
    expect(allRuns.length).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Scheduled Conversation Idle Scanner & Auto-Re-engagement
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 3: Scans idle conversations, triggers CONVERSATION_IDLE automation, and avoids duplicate execution', async () => {
    const ws = await createWorkspaceFixture({ name: 'Idle Scanner Workspace' });

    const contact = await createContactFixture(ws.workspaceId, {
      name: 'Danish Ali',
      phoneE164: '+923004445566',
    });

    // Create an open conversation that has been idle for 2 hours (120 minutes)
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
    const idleConversation = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        lastMessageAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
      },
    });

    // Configure active CONVERSATION_IDLE automation (threshold: 60 mins)
    await createAutomation(ws.context, {
      name: 'Idle Conversation Followup',
      isActive: true,
      triggerType: 'CONVERSATION_IDLE',
      triggerConfig: { idleMinutes: 60 },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Hi Danish! Checking in to see if you have any questions.' },
        },
        {
          position: 1,
          type: 'ADD_TAG',
          config: { tags: ['idle-followup-sent'] },
        },
        {
          position: 2,
          type: 'SET_PRIORITY',
          config: { priority: 'LOW' },
        },
      ],
    });

    // Run idle scanner service
    const scanResult1 = await scanAndTriggerIdleConversations(prisma, ws.workspaceId, 60);
    expect(scanResult1.conversationsScanned).toBe(1);
    expect(scanResult1.automationsTriggered).toBe(1);

    // Verify message sent, tag added, and priority lowered
    const messages = await prisma.message.findMany({
      where: { workspaceId: ws.workspaceId, conversationId: idleConversation.id },
    });
    expect(messages.length).toBe(1);
    expect(messages[0]!.body).toContain('Hi Danish! Checking in');

    const convAfter = await prisma.conversation.findUniqueOrThrow({
      where: { id: idleConversation.id },
    });
    expect(convAfter.priority).toBe('LOW');

    // Run idle scanner background job handler (automation.check_idle)
    await automationCheckIdleHandler(
      { workspaceId: ws.workspaceId, idleMinutes: 60 },
      createMockJobContext('idle-job-id'),
    );

    // Because the conversation was updated with the outbound message, it is no longer idle!
    const scanResult2 = await scanAndTriggerIdleConversations(prisma, ws.workspaceId, 60);
    expect(scanResult2.conversationsScanned).toBe(0);
    expect(scanResult2.automationsTriggered).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4: Keyword Triggers, Match Modes & Action Chaining
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 4: Evaluates MESSAGE_CONTAINS keywords accurately and chains actions with audit note logging', async () => {
    const ws = await createWorkspaceFixture({ name: 'Keywords Workspace' });

    const contact = await createContactFixture(ws.workspaceId, {
      name: 'Kamran Shah',
      phoneE164: '+923008889900',
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        priority: 'NORMAL',
      },
    });

    // Configure MESSAGE_CONTAINS trigger for wholesale inquiries
    await createAutomation(ws.context, {
      name: 'Wholesale Lead Qualifier',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: {
        keywords: ['wholesale', 'bulk order', 'bulk pricing'],
        matchMode: 'ANY',
        caseSensitive: false,
      },
      actions: [
        {
          position: 0,
          type: 'ADD_TAG',
          config: { tags: ['wholesale-inquiry'] },
        },
        {
          position: 1,
          type: 'SET_LEAD_STAGE',
          config: { stage: 'QUALIFIED' },
        },
        {
          position: 2,
          type: 'SET_PRIORITY',
          config: { priority: 'URGENT' },
        },
        {
          position: 3,
          type: 'CREATE_NOTE',
          config: { content: 'Customer requested wholesale catalog.' },
        },
      ],
    });

    // Simulate incoming message trigger
    await triggerAutomations(prisma, ws.workspaceId, {
      triggerType: 'MESSAGE_CONTAINS',
      subjectType: 'Conversation',
      subjectId: conversation.id,
      eventKey: `msg:${Date.now()}`,
      data: {
        body: 'Hello, I am interested in placing a Wholesale order for my boutique.',
      },
    });

    // Assert contact & conversation mutations
    const contactAfter = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
    });
    expect(contactAfter.leadStage).toBe('QUALIFIED');

    const tags = await prisma.contactTag.findMany({
      where: { contactId: contact.id },
      include: { tag: true },
    });
    expect(tags.some((t) => t.tag.name === 'wholesale-inquiry')).toBe(true);

    const convAfter = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(convAfter.priority).toBe('URGENT');

    // Assert audit log note created
    const auditLogs = await prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, action: 'automation.note_created' },
    });
    expect(auditLogs.length).toBe(1);
    expect((auditLogs[0]!.metadata as any)?.content).toContain('wholesale catalog');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: Multi-Tenant Isolation & Zero Cross-Tenant Data Bleed
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 5: Guarantees strict multi-tenant isolation across automations, runs, and notifications', async () => {
    const wsA = await createWorkspaceFixture({ name: 'Tenant Alpha' });
    const wsB = await createWorkspaceFixture({ name: 'Tenant Beta' });

    // Create automation in Tenant Alpha
    const autoA = await createAutomation(wsA.context, {
      name: 'Alpha Automation',
      isActive: true,
      triggerType: 'MESSAGE_RECEIVED',
      actions: [
        {
          position: 0,
          type: 'NOTIFY_TEAM',
          config: { title: 'Alpha Alert', level: 'INFO' },
        },
      ],
    });

    // Create automation in Tenant Beta
    const autoB = await createAutomation(wsB.context, {
      name: 'Beta Automation',
      isActive: true,
      triggerType: 'MESSAGE_RECEIVED',
      actions: [
        {
          position: 0,
          type: 'NOTIFY_TEAM',
          config: { title: 'Beta Alert', level: 'WARNING' },
        },
      ],
    });

    // Trigger event in Tenant Alpha
    await triggerAutomations(prisma, wsA.workspaceId, {
      triggerType: 'MESSAGE_RECEIVED',
      subjectType: 'Conversation',
      subjectId: crypto.randomUUID(),
      eventKey: `event:${Date.now()}`,
      data: { body: 'Message in Alpha' },
    });

    // Tenant Alpha has 1 run and 1 notification
    const runsA = await prisma.automationRun.findMany({ where: { workspaceId: wsA.workspaceId } });
    const notifsA = await prisma.notification.findMany({ where: { workspaceId: wsA.workspaceId } });
    expect(runsA.length).toBe(1);
    expect(notifsA.length).toBe(1);
    expect(notifsA[0]!.title).toBe('Alpha Alert');

    // Tenant Beta has 0 runs and 0 notifications
    const runsB = await prisma.automationRun.findMany({ where: { workspaceId: wsB.workspaceId } });
    const notifsB = await prisma.notification.findMany({ where: { workspaceId: wsB.workspaceId } });
    expect(runsB.length).toBe(0);
    expect(notifsB.length).toBe(0);

    // Cross-tenant read via Service Layer fails with NotFoundError
    await expect(getAutomation(wsB.context, autoA.id)).rejects.toThrow();
    await expect(getAutomation(wsA.context, autoB.id)).rejects.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: Role-Based Access Control (RBAC) Enforcement
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 6: Enforces RBAC permissions on automation creation, editing, and deletion', async () => {
    const ws = await createWorkspaceFixture({ name: 'RBAC Workspace' });

    // Create members with various roles
    const manager = await createMemberFixture(ws.workspaceId, 'MANAGER');
    const agent = await createMemberFixture(ws.workspaceId, 'AGENT');
    const viewer = await createMemberFixture(ws.workspaceId, 'VIEWER');

    const managerCtx = { ...ws.context, role: 'MANAGER' as const, membershipId: manager.membershipId };
    const agentCtx = { ...ws.context, role: 'AGENT' as const, membershipId: agent.membershipId };
    const viewerCtx = { ...ws.context, role: 'VIEWER' as const, membershipId: viewer.membershipId };

    // 1. OWNER / ADMIN / MANAGER can create automations
    const auto = await createAutomation(managerCtx, {
      name: 'Manager Created Automation',
      isActive: true,
      triggerType: 'CONTACT_CREATED',
      actions: [
        {
          position: 0,
          type: 'ADD_TAG',
          config: { tags: ['new-contact'] },
        },
      ],
    });
    expect(auto.id).toBeDefined();

    // 2. AGENT and VIEWER cannot create automations
    await expect(
      createAutomation(agentCtx, {
        name: 'Agent Automation',
        isActive: true,
        triggerType: 'CONTACT_CREATED',
        actions: [{ position: 0, type: 'ADD_TAG', config: { tags: ['tag'] } }],
      }),
    ).rejects.toThrow();

    await expect(
      createAutomation(viewerCtx, {
        name: 'Viewer Automation',
        isActive: true,
        triggerType: 'CONTACT_CREATED',
        actions: [{ position: 0, type: 'ADD_TAG', config: { tags: ['tag'] } }],
      }),
    ).rejects.toThrow();

    // 3. AGENT and VIEWER cannot delete or toggle automations
    await expect(toggleAutomation(agentCtx, auto.id, false)).rejects.toThrow();
    await expect(deleteAutomation(viewerCtx, auto.id)).rejects.toThrow();

    // 4. MANAGER can toggle and update, but cannot delete (delete requires ADMIN/OWNER)
    await toggleAutomation(managerCtx, auto.id, false);
    const toggled = await getAutomation(managerCtx, auto.id);
    expect(toggled.isActive).toBe(false);

    await expect(deleteAutomation(managerCtx, auto.id)).rejects.toThrow();

    // 5. OWNER can delete
    await deleteAutomation(ws.context, auto.id);
    await expect(getAutomation(ws.context, auto.id)).rejects.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7: In-App Notification Center Lifecycle
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 7: Manages in-app notification center lifecycle, unread badges, and mark-all-read operations', async () => {
    const ws = await createWorkspaceFixture({ name: 'Notification Center Workspace' });
    const ctx = ws.context;

    // 1. Create notifications
    await createSystemNotification(prisma, ws.workspaceId, {
      memberId: ctx.membershipId,
      type: 'HUMAN_HANDOFF',
      level: 'WARNING',
      title: 'Urgent Takeover Needed',
      body: 'High value customer requested escalation.',
    });

    await createSystemNotification(prisma, ws.workspaceId, {
      memberId: ctx.membershipId,
      type: 'USAGE_LIMIT_WARNING',
      level: 'INFO',
      title: 'Daily Report Ready',
      body: 'Daily statistics generated.',
    });

    // 2. Query unread count
    const initialCount = await getUnreadNotificationCount(ctx);
    expect(initialCount).toBe(2);

    // 3. List notifications
    const list = await listNotifications(ctx);
    expect(list.length).toBe(2);

    // 4. Mark single notification as read
    const firstNotif = list[0]!;
    await markNotificationAsRead(ctx, firstNotif.id);

    const countAfterOne = await getUnreadNotificationCount(ctx);
    expect(countAfterOne).toBe(1);

    // 5. Mark all as read
    await markAllNotificationsAsRead(ctx);
    const finalCount = await getUnreadNotificationCount(ctx);
    expect(finalCount).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8: AI Guardrails & Human Takeover Monotonicity
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 8: Verifies PAUSE_AI and RESUME_AI actions maintain safety guardrails and audit integrity', async () => {
    const ws = await createWorkspaceFixture({ name: 'AI Guardrail Workspace' });

    const contact = await createContactFixture(ws.workspaceId, {
      name: 'Hamza Sheikh',
      phoneE164: '+923005556677',
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        aiEnabled: true,
      },
    });

    // Trigger PAUSE_AI automation
    const pauseAutomation = await createAutomation(ws.context, {
      name: 'Pause AI on Complaint',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: { keywords: ['complaint', 'manager'] },
      actions: [
        {
          position: 0,
          type: 'PAUSE_AI',
          config: { reason: 'COMPLAINT' },
        },
        {
          position: 1,
          type: 'NOTIFY_TEAM',
          config: { title: 'Complaint Escalation', level: 'WARNING' },
        },
      ],
    });

    await triggerAutomations(prisma, ws.workspaceId, {
      triggerType: 'MESSAGE_CONTAINS',
      subjectType: 'Conversation',
      subjectId: conversation.id,
      eventKey: `complaint:${Date.now()}`,
      data: { body: 'I want to make a formal complaint to the manager.' },
    });

    const convPaused = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(convPaused.aiEnabled).toBe(false);
    expect(convPaused.handoffReason).toBe('COMPLAINT');
    expect(convPaused.handoffAt).not.toBeNull();

    // Trigger RESUME_AI automation
    const resumeAutomation = await createAutomation(ws.context, {
      name: 'Resume AI on Issue Resolved',
      isActive: true,
      triggerType: 'CONVERSATION_RESOLVED',
      actions: [
        {
          position: 0,
          type: 'RESUME_AI',
          config: {},
        },
      ],
    });

    await triggerAutomations(prisma, ws.workspaceId, {
      triggerType: 'CONVERSATION_RESOLVED',
      subjectType: 'Conversation',
      subjectId: conversation.id,
      eventKey: `resolved:${Date.now()}`,
      data: {},
    });

    const convResumed = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(convResumed.aiEnabled).toBe(true);
    expect(convResumed.handoffReason).toBeNull();
    expect(convResumed.handoffAt).toBeNull();
  });
});
