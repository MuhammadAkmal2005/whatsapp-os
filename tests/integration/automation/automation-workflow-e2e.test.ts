/**
 * End-to-End Automation & Notification Lifecycle Integration Tests.
 *
 * Verifies full automation lifecycle:
 * 1. Automation creation & configuration
 * 2. Event triggering & action execution
 * 3. Wait step suspension & background resumption
 * 4. In-app notification creation
 * 5. Notification reading & status updating
 */

import { describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { automationResumeHandler } from '@/server/jobs/handlers/automation.handler';
import { createAutomation } from '@/server/services/automation/automation.service';
import { triggerAutomations } from '@/server/services/automation/automation-engine.service';
import {
  listNotifications,
  markNotificationAsRead,
  getUnreadNotificationCount,
} from '@/server/services/notification/notification.service';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';

describe('Automation & Notification E2E Integration Tests (Phase 6 Unit 2)', () => {
  it('completes the full lifecycle: trigger -> action -> wait -> resume -> notification -> mark read', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'E2E Automation Workspace' });
    const ctx = ws.context;
    const workspace = { id: ws.workspaceId, slug: ws.workspaceSlug };

    // 1. Create a Contact, Conversation & Order
    const contact = await prisma.contact.create({
      data: {
        workspaceId: workspace.id,
        phoneE164: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        name: 'Fatima Ali',
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: workspace.id,
        contactId: contact.id,
        status: 'OPEN',
      },
    });

    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        orderNumber: 'ORD-E2E-100',
        contactId: contact.id,
        conversationId: conversation.id,
        status: 'PENDING',
        customerName: contact.name ?? 'Fatima Ali',
        phoneE164: contact.phoneE164,
        subtotalMinor: 500000,
        totalMinor: 500000,
      },
    });

    // 2. Create an automation rule via Service Layer
    const createdAutomation = await createAutomation(ctx, {
      name: 'Order Confirmed Multistep Workflow',
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
          config: { body: 'Your order has been confirmed and is being processed!' },
        },
        {
          position: 1,
          type: 'ADD_TAG',
          config: { tags: ['order-confirmed', 'high-value'] },
        },
        {
          position: 2,
          type: 'WAIT',
          config: { durationSeconds: 600 },
        },
        {
          position: 3,
          type: 'NOTIFY_TEAM',
          config: {
            title: 'Order packing follow-up',
            body: 'Please pack and dispatch order ORD-E2E-100',
            level: 'INFO',
          },
        },
      ],
    });

    expect(createdAutomation.id).toBeDefined();

    // 3. Trigger the domain event for ORDER_STATUS_CHANGED
    const triggerResults = await triggerAutomations(prisma, workspace.id, {
      triggerType: 'ORDER_STATUS_CHANGED',
      subjectType: 'Order',
      subjectId: order.id,
      eventKey: `status_change_confirmed_${order.id}`,
      data: {
        orderId: order.id,
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
      },
    });

    expect(triggerResults).toHaveLength(1);
    expect(triggerResults[0]!.status).toBe('WAITING');

    const runId = triggerResults[0]!.runId;

    // 4. Verify Immediate Actions executed before WAIT
    // Action 0: SEND_MESSAGE
    const messages = await prisma.message.findMany({
      where: { workspaceId: workspace.id, conversationId: conversation.id },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe('Your order has been confirmed and is being processed!');

    // Action 1: ADD_TAG
    const contactTags = await prisma.contactTag.findMany({
      where: { contactId: contact.id },
      include: { tag: true },
    });
    const tagNames = contactTags.map((ct) => ct.tag.name);
    expect(tagNames).toContain('order-confirmed');
    expect(tagNames).toContain('high-value');

    // 5. Verify AutomationRun is WAITING at action index 3
    const waitingRun = await prisma.automationRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(waitingRun.status).toBe('WAITING');
    expect(waitingRun.currentActionPosition).toBe(3);

    // 6. Simulate worker processing the delayed automation.resume job
    await automationResumeHandler(
      {
        workspaceId: workspace.id,
        runId,
        actionIndex: 3,
      },
      { jobId: 'mock-resume-job-e2e', attempt: 1, maxAttempts: 3, signal: new AbortController().signal },
    );

    // 7. Verify Run has COMPLETED
    const completedRun = await prisma.automationRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(completedRun.status).toBe('COMPLETED');
    expect(completedRun.finishedAt).toBeDefined();

    // 8. Verify Notification was created for NOTIFY_TEAM
    const notifications = await listNotifications(ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Order packing follow-up');
    expect(notifications[0]!.readAt).toBeNull();

    // 9. Verify unread count is 1
    const unreadCountBefore = await getUnreadNotificationCount(ctx);
    expect(unreadCountBefore).toBe(1);

    // 10. Mark notification as read
    await markNotificationAsRead(ctx, notifications[0]!.id);

    // 11. Verify unread count is now 0 and readAt is stamped
    const unreadCountAfter = await getUnreadNotificationCount(ctx);
    expect(unreadCountAfter).toBe(0);

    const readNotification = await prisma.notification.findUniqueOrThrow({
      where: { id: notifications[0]!.id },
    });
    expect(readNotification.readAt).toBeDefined();
  });
});
