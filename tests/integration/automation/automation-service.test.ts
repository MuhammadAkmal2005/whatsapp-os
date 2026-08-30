/**
 * Automation Service Integration Tests.
 *
 * Verifies Automation CRUD, tenant isolation, and RBAC authorization
 * against a real PostgreSQL database.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  toggleAutomation,
  updateAutomation,
} from '@/server/services/automation/automation.service';
import type { CreateAutomationInput } from '@/server/validation/automation';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

describe('Automation Service Integration Tests', () => {
  let wsA: WorkspaceFixture;
  let wsB: WorkspaceFixture;

  beforeEach(async () => {
    await resetDatabase();
    wsA = await createWorkspaceFixture({ name: 'Workspace Alpha' });
    wsB = await createWorkspaceFixture({ name: 'Workspace Beta' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. creates an automation with ordered actions and stores it in the database', async () => {
    const ctx = wsA.context;

    const input: CreateAutomationInput = {
      name: 'Welcome Series',
      description: 'Sends initial message and tags contact',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: {
        keywords: ['help', 'info'],
        matchMode: 'ANY',
      },
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Welcome to our store!' },
        },
        {
          position: 1,
          type: 'ADD_TAG',
          config: { tags: ['inquiry', 'new-lead'] },
        },
        {
          position: 2,
          type: 'SET_PRIORITY',
          config: { priority: 'HIGH' },
        },
      ],
    };

    const created = await createAutomation(ctx, input);

    expect(created.id).toBeDefined();
    expect(created.name).toBe('Welcome Series');
    expect(created.isActive).toBe(true);
    expect(created.triggerType).toBe('MESSAGE_CONTAINS');
    expect(created.actions.length).toBe(3);
    expect(created.actions[0]?.type).toBe('SEND_MESSAGE');
    expect(created.actions[1]?.type).toBe('ADD_TAG');
    expect(created.actions[2]?.type).toBe('SET_PRIORITY');

    // Verify audit log
    const auditLogs = await prisma.auditLog.findMany({
      where: { workspaceId: wsA.workspaceId, action: 'automation.created' },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0]?.resourceId).toBe(created.id);
  });

  it('2. enforces strict tenant isolation on reads and updates', async () => {
    const ctxA = wsA.context;
    const ctxB = wsB.context;

    const created = await createAutomation(ctxA, {
      name: 'Tenant A Automation',
      triggerType: 'CONVERSATION_OPENED',
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Hello from Tenant A' },
        },
      ],
    });

    // Workspace B cannot read Workspace A's automation
    await expect(getAutomation(ctxB, created.id)).rejects.toThrow(NotFoundError);

    // Workspace B cannot update Workspace A's automation
    await expect(
      updateAutomation(ctxB, created.id, { name: 'Hacked Name' }),
    ).rejects.toThrow(NotFoundError);

    // Workspace B cannot delete Workspace A's automation
    await expect(deleteAutomation(ctxB, created.id)).rejects.toThrow(NotFoundError);

    // Listing in Workspace B returns 0 automations
    const listB = await listAutomations(ctxB);
    expect(listB.items.length).toBe(0);
    expect(listB.total).toBe(0);
  });

  it('3. enforces role-based authorization (RBAC)', async () => {
    const manager = await createMemberFixture(wsA.workspaceId, 'MANAGER');
    const agent = await createMemberFixture(wsA.workspaceId, 'AGENT');
    const viewer = await createMemberFixture(wsA.workspaceId, 'VIEWER');

    const ctxManager = tenantContextFor({
      workspaceId: wsA.workspaceId,
      workspaceSlug: wsA.workspaceSlug,
      workspaceName: 'Workspace Alpha',
      currency: 'PKR',
      userId: manager.userId,
      userName: manager.name,
      userEmail: manager.email,
      membershipId: manager.membershipId,
      role: 'MANAGER',
    });

    const ctxAgent = tenantContextFor({
      workspaceId: wsA.workspaceId,
      workspaceSlug: wsA.workspaceSlug,
      workspaceName: 'Workspace Alpha',
      currency: 'PKR',
      userId: agent.userId,
      userName: agent.name,
      userEmail: agent.email,
      membershipId: agent.membershipId,
      role: 'AGENT',
    });

    const ctxViewer = tenantContextFor({
      workspaceId: wsA.workspaceId,
      workspaceSlug: wsA.workspaceSlug,
      workspaceName: 'Workspace Alpha',
      currency: 'PKR',
      userId: viewer.userId,
      userName: viewer.name,
      userEmail: viewer.email,
      membershipId: viewer.membershipId,
      role: 'VIEWER',
    });

    // Manager can create
    const created = await createAutomation(ctxManager, {
      name: 'Manager Automation',
      triggerType: 'CONTACT_CREATED',
      actions: [
        {
          position: 0,
          type: 'ADD_TAG',
          config: { tags: ['crm-created'] },
        },
      ],
    });
    expect(created.id).toBeDefined();

    // Agent cannot create
    await expect(
      createAutomation(ctxAgent, {
        name: 'Agent Automation',
        triggerType: 'CONTACT_CREATED',
        actions: [{ position: 0, type: 'SEND_MESSAGE', config: { body: 'Hi' } }],
      }),
    ).rejects.toThrow(ForbiddenError);

    // Viewer cannot create or update
    await expect(
      createAutomation(ctxViewer, {
        name: 'Viewer Automation',
        triggerType: 'CONTACT_CREATED',
        actions: [{ position: 0, type: 'SEND_MESSAGE', config: { body: 'Hi' } }],
      }),
    ).rejects.toThrow(ForbiddenError);

    // Manager can update
    const updated = await updateAutomation(ctxManager, created.id, {
      name: 'Manager Updated Automation',
    });
    expect(updated.name).toBe('Manager Updated Automation');

    // Manager cannot delete (only ADMIN and OWNER hold automation:delete)
    await expect(deleteAutomation(ctxManager, created.id)).rejects.toThrow(ForbiddenError);

    // Admin can delete
    const admin = await createMemberFixture(wsA.workspaceId, 'ADMIN');
    const ctxAdmin = tenantContextFor({
      workspaceId: wsA.workspaceId,
      workspaceSlug: wsA.workspaceSlug,
      workspaceName: 'Workspace Alpha',
      currency: 'PKR',
      userId: admin.userId,
      userName: admin.name,
      userEmail: admin.email,
      membershipId: admin.membershipId,
      role: 'ADMIN',
    });
    await deleteAutomation(ctxAdmin, created.id);

    await expect(getAutomation(ctxAdmin, created.id)).rejects.toThrow(NotFoundError);
  });

  it('4. toggles active status and updates actions transactionally', async () => {
    const ctx = wsA.context;

    const created = await createAutomation(ctx, {
      name: 'Toggle Test',
      isActive: false,
      triggerType: 'ORDER_CREATED',
      actions: [
        {
          position: 0,
          type: 'NOTIFY_TEAM',
          config: { title: 'New Order Created' },
        },
      ],
    });
    expect(created.isActive).toBe(false);

    const activated = await toggleAutomation(ctx, created.id, true);
    expect(activated.isActive).toBe(true);

    // Replace actions
    const withNewActions = await updateAutomation(ctx, created.id, {
      actions: [
        {
          position: 0,
          type: 'SEND_MESSAGE',
          config: { body: 'Thank you for your order!' },
        },
        {
          position: 1,
          type: 'NOTIFY_TEAM',
          config: { title: 'Order confirmation sent' },
        },
      ],
    });

    expect(withNewActions.actions.length).toBe(2);
    expect(withNewActions.actions[0]?.type).toBe('SEND_MESSAGE');
    expect(withNewActions.actions[1]?.type).toBe('NOTIFY_TEAM');
  });
});
