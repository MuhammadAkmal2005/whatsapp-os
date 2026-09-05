/**
 * Unit Tests for Human Approval V1.
 *
 * Validates the 5-level action authority model, ActionApproval lifecycle,
 * state machine transitions, RBAC authorization, idempotency, stale-state protection,
 * unsupported action handling (refunds/discounts), grounding truthfulness, and tenant isolation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '@/db/prisma';
import type { TenantContext, WorkspaceActorContext } from '@/server/tenancy/context';
import {
  createApprovalRequest,
  getApprovalRequest,
  listPendingApprovals,
  approveRequest,
  rejectRequest,
  executeApprovedRequest,
} from '@/server/services/approval/approval.service';
import { requestOrderCancellationTool } from '@/server/services/agent/tools/impl/request-order-cancellation.tool';
import { validateGrounding } from '@/server/services/agent/grounding.service';
import { ForbiddenError, NotFoundError } from '@/server/errors';

vi.mock('@/db/prisma', () => {
  const mockPrisma: any = {
    actionApproval: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    orderItem: {
      findMany: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return {
    prisma: mockPrisma,
    isUniqueConstraintViolation: vi.fn(() => false),
  };
});

vi.mock('@/server/repositories/conversation.repository', () => ({
  findConversationById: vi.fn(),
}));

vi.mock('@/server/repositories/inventory.repository', () => ({
  releaseStock: vi.fn(),
}));

vi.mock('@/server/services/agent/handoff.service', () => ({
  triggerHumanHandoff: vi.fn(),
}));

import { findConversationById } from '@/server/repositories/conversation.repository';
import { releaseStock } from '@/server/repositories/inventory.repository';
import { triggerHumanHandoff } from '@/server/services/agent/handoff.service';

const WORKSPACE_A = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const MEMBER_ID = '44444444-4444-4444-4444-444444444444';
const ORDER_ID = '55555555-5555-5555-5555-555555555555';
const CONTACT_ID = '66666666-6666-6666-6666-666666666666';
const CONVERSATION_ID = '77777777-7777-7777-7777-777777777777';
const APPROVAL_ID = '88888888-8888-8888-8888-888888888888';

function makeStaffContext(role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER' = 'MANAGER', workspaceId = WORKSPACE_A): TenantContext {
  return {
    user: {
      id: USER_ID,
      email: 'staff@example.com',
      name: 'Staff Member',
      emailVerifiedAt: new Date(),
      avatarUrl: null,
    },
    workspaceId,
    workspaceSlug: 'test-store',
    workspaceName: 'Test Store',
    role,
    membershipId: MEMBER_ID,
    sessionId: 'session-1',
    currency: 'PKR',
    planKey: 'growth',
    onboarding: { completedSteps: [], completedAt: new Date() },
    requestId: 'req-1',
  };
}

function makeActorContext(role: 'AGENT' = 'AGENT', workspaceId = WORKSPACE_A): WorkspaceActorContext {
  return {
    workspaceId,
    workspaceName: 'Test Store',
    role,
    membershipId: null,
    currency: 'PKR',
  };
}

describe('Human Approval V1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. APPROVAL LIFECYCLE
  // =========================================================================
  describe('1. Approval Lifecycle (Create, List, Approve, Reject)', () => {
    it('creates a pending approval request with notification and audit log', async () => {
      const actorCtx = makeActorContext();

      const mockApproval = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        conversationId: CONVERSATION_ID,
        contactId: CONTACT_ID,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
        requestedByType: 'AI_AGENT',
        requestedById: null,
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
        payload: null,
        reason: 'Customer requested cancellation due to wrong size',
        decisionReason: null,
        resolvedByMemberId: null,
        resolvedAt: null,
        executedAt: null,
        executionResult: null,
        idempotencyKey: 'approval:cancel:msg-1:order-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.actionApproval.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.actionApproval.create).mockResolvedValue(mockApproval as any);
      vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      const result = await createApprovalRequest(actorCtx, {
        actionType: 'ORDER_CANCEL',
        conversationId: CONVERSATION_ID,
        contactId: CONTACT_ID,
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
        reason: 'Customer requested cancellation due to wrong size',
        idempotencyKey: 'approval:cancel:msg-1:order-1',
      });

      expect(result.id).toBe(APPROVAL_ID);
      expect(result.status).toBe('PENDING');

      // Verify notification created for workspace staff
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_A,
            type: 'APPROVAL_REQUESTED',
            level: 'WARNING',
            resourceType: 'ActionApproval',
            resourceId: APPROVAL_ID,
          }),
        }),
      );

      // Verify audit log recorded
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_A,
            action: 'APPROVAL_REQUESTED',
            resourceType: 'ActionApproval',
            resourceId: APPROVAL_ID,
          }),
        }),
      );
    });

    it('lists pending approvals for the workspace', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockApprovals = [
        {
          id: APPROVAL_ID,
          workspaceId: WORKSPACE_A,
          actionType: 'ORDER_CANCEL',
          status: 'PENDING',
          targetEntityType: 'Order',
          targetEntityId: ORDER_ID,
          reason: 'Cancel order',
          createdAt: new Date(),
        },
      ];

      vi.mocked(prisma.actionApproval.findMany).mockResolvedValue(mockApprovals as any);

      const pending = await listPendingApprovals(staffCtx);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.status).toBe('PENDING');
      expect(prisma.actionApproval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: WORKSPACE_A,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('approves a request, executes cancellation domain logic, and marks EXECUTED', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockPending = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
        reason: 'Customer changed mind',
      };

      const mockApproved = {
        ...mockPending,
        status: 'APPROVED',
        resolvedByMemberId: MEMBER_ID,
        resolvedAt: new Date(),
      };

      const mockOrder = {
        id: ORDER_ID,
        orderNumber: 'CN-2609-0010',
        workspaceId: WORKSPACE_A,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        paymentMethod: 'COD',
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockPending as any);
      vi.mocked(prisma.actionApproval.update)
        .mockResolvedValueOnce(mockApproved as any) // on approve
        .mockResolvedValueOnce({ ...mockApproved, status: 'EXECUTED' } as any); // on execute

      // Order mock for execution
      vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder as any);
      vi.mocked(prisma.orderItem.findMany).mockResolvedValue([
        { productId: 'prod-1', variantId: null, quantity: 2 },
      ] as any);
      vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.orderEvent.create).mockResolvedValue({} as any);

      const result = await approveRequest(staffCtx, APPROVAL_ID, {
        decisionReason: 'Approved as requested by customer',
      });

      expect(result.status).toBe('EXECUTED');
      // Stock released
      expect(releaseStock).toHaveBeenCalledWith(
        expect.anything(),
        WORKSPACE_A,
        'prod-1',
        null,
        2,
      );

      // Audit logs created
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'APPROVAL_APPROVED',
            actorMemberId: MEMBER_ID,
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'APPROVAL_EXECUTED',
            actorMemberId: MEMBER_ID,
          }),
        }),
      );
    });

    it('rejects a pending request with required reason and does not execute mutation', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockPending = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockPending as any);
      vi.mocked(prisma.actionApproval.update).mockResolvedValue({
        ...mockPending,
        status: 'REJECTED',
        decisionReason: 'Order is already being packed for shipment',
      } as any);

      const result = await rejectRequest(staffCtx, APPROVAL_ID, {
        decisionReason: 'Order is already being packed for shipment',
      });

      expect(result.status).toBe('REJECTED');
      // Order cancellation was NOT called
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(releaseStock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. INVALID STATE TRANSITIONS
  // =========================================================================
  describe('2. State Machine & Invalid Transition Enforcement', () => {
    it('blocks approving an already REJECTED approval', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockRejected = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'REJECTED',
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockRejected as any);

      await expect(
        approveRequest(staffCtx, APPROVAL_ID, { decisionReason: 'Try to approve' }),
      ).rejects.toThrow(/Cannot approve an approval request in status: REJECTED/);
    });

    it('blocks rejecting an already EXECUTED approval', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockExecuted = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'EXECUTED',
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockExecuted as any);

      await expect(
        rejectRequest(staffCtx, APPROVAL_ID, { decisionReason: 'Try to reject' }),
      ).rejects.toThrow(/Cannot reject an approval request in status: EXECUTED/);
    });
  });

  // =========================================================================
  // 3. AUTHORIZATION & RBAC ENFORCEMENT
  // =========================================================================
  describe('3. RBAC Authorization & Actor Enforcement', () => {
    it('prevents AI Agent (role: AGENT) from approving requests', async () => {
      const aiCtx = makeStaffContext('AGENT');
      // AI actor has no membershipId
      const aiActor = { ...aiCtx, membershipId: null };

      await expect(
        approveRequest(aiActor as any, APPROVAL_ID, { decisionReason: 'AI approves' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('prevents VIEWER role from approving requests', async () => {
      const viewerCtx = makeStaffContext('VIEWER');

      const mockPending = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
      };
      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockPending as any);

      await expect(
        approveRequest(viewerCtx, APPROVAL_ID, { decisionReason: 'Viewer approves' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('enforces tenant boundary: Workspace B cannot view or approve Workspace A request', async () => {
      const staffWorkspaceB = makeStaffContext('OWNER', WORKSPACE_B);

      // Scoped query returns null for mismatched workspace
      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(null);

      await expect(
        approveRequest(staffWorkspaceB, APPROVAL_ID, { decisionReason: 'Cross tenant' }),
      ).rejects.toThrow(NotFoundError);

      expect(prisma.actionApproval.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: APPROVAL_ID,
            workspaceId: WORKSPACE_B,
          }),
        }),
      );
    });
  });

  // =========================================================================
  // 4. IDEMPOTENCY & DUPLICATE PROTECTION
  // =========================================================================
  describe('4. Idempotency & Duplicate Protection', () => {
    it('returns existing approval on duplicate createApprovalRequest with same key', async () => {
      const actorCtx = makeActorContext();

      const existingApproval = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
        idempotencyKey: 'approval:cancel:key-1',
      };

      vi.mocked(prisma.actionApproval.findUnique).mockResolvedValue(existingApproval as any);

      const result = await createApprovalRequest(actorCtx, {
        actionType: 'ORDER_CANCEL',
        idempotencyKey: 'approval:cancel:key-1',
      });

      expect(result.id).toBe(APPROVAL_ID);
      // create was NOT called again
      expect(prisma.actionApproval.create).not.toHaveBeenCalled();
      // notification was NOT duplicated
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('returns existing approval without re-executing if staff double-clicks Approve', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const alreadyExecuted = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'EXECUTED',
        executionResult: { success: true, orderNumber: 'CN-2609-0010' },
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(alreadyExecuted as any);

      const result = await approveRequest(staffCtx, APPROVAL_ID);

      expect(result.status).toBe('EXECUTED');
      // No database mutations repeated
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(releaseStock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. STALE STATE REVALIDATION
  // =========================================================================
  describe('5. Stale-State Protection (Scenario 4)', () => {
    it('blocks cancellation and marks FAILED if order transitioned to DELIVERED while pending', async () => {
      const staffCtx = makeStaffContext('MANAGER');

      const mockPending = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'ORDER_CANCEL',
        status: 'PENDING',
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
      };

      const mockApproved = {
        ...mockPending,
        status: 'APPROVED',
      };

      // Live order is now DELIVERED!
      const mockDeliveredOrder = {
        id: ORDER_ID,
        orderNumber: 'CN-2609-0010',
        workspaceId: WORKSPACE_A,
        status: 'DELIVERED',
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockPending as any);
      vi.mocked(prisma.actionApproval.update)
        .mockResolvedValueOnce(mockApproved as any) // on approve
        .mockResolvedValueOnce({
          ...mockApproved,
          status: 'FAILED',
          decisionReason: 'Order is already DELIVERED.',
        } as any); // on stale failure

      vi.mocked(prisma.order.findFirst).mockResolvedValue(mockDeliveredOrder as any);

      const result = await approveRequest(staffCtx, APPROVAL_ID);

      expect(result.status).toBe('FAILED');
      // Mutation was prevented!
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(releaseStock).not.toHaveBeenCalled();

      // Audit recorded stale prevention
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'APPROVAL_STALE_PREVENTED',
            resourceType: 'ActionApproval',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // 6. UNSUPPORTED MUTATIONS (REFUND / DISCOUNT)
  // =========================================================================
  describe('6. Unsupported Mutations (Scenario 5 & 6)', () => {
    it('flags manual off-platform processing for refund approval without fake disbursement', async () => {
      const adminCtx = makeStaffContext('ADMIN');

      const mockPendingRefund = {
        id: APPROVAL_ID,
        workspaceId: WORKSPACE_A,
        actionType: 'REFUND_REQUEST',
        status: 'PENDING',
        targetEntityType: 'Order',
        targetEntityId: ORDER_ID,
        reason: 'Customer returned package and requested bank transfer refund',
      };

      vi.mocked(prisma.actionApproval.findFirst).mockResolvedValue(mockPendingRefund as any);
      vi.mocked(prisma.actionApproval.update)
        .mockResolvedValueOnce({ ...mockPendingRefund, status: 'APPROVED' } as any)
        .mockResolvedValueOnce({
          ...mockPendingRefund,
          status: 'EXECUTED',
          executionResult: {
            success: true,
            manualProcessingRequired: true,
            message: 'Refund request approved by management for manual off-platform processing.',
          },
        } as any);

      const result = await approveRequest(adminCtx, APPROVAL_ID);

      expect(result.status).toBe('EXECUTED');
      expect((result.executionResult as any)?.manualProcessingRequired).toBe(true);
    });
  });

  // =========================================================================
  // 7. TOOL INTEGRATION & GROUNDING HONESTY
  // =========================================================================
  describe('7. AI Tool Integration & Grounding Honesty', () => {
    it('request_order_cancellation tool creates approval request and triggers human handoff', async () => {
      const toolCtx = {
        workspaceId: WORKSPACE_A,
        conversationId: CONVERSATION_ID,
        messageId: 'msg-101',
        role: 'AGENT' as const,
        membershipId: null,
      };

      const mockOrder = {
        id: ORDER_ID,
        orderNumber: 'CN-2609-0010',
        workspaceId: WORKSPACE_A,
        contactId: CONTACT_ID,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
      };

      vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder as any);
      vi.mocked(findConversationById).mockResolvedValue({
        id: CONVERSATION_ID,
        contactId: CONTACT_ID,
      } as any);

      vi.mocked(prisma.actionApproval.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.actionApproval.create).mockResolvedValue({
        id: APPROVAL_ID,
        status: 'PENDING',
      } as any);
      vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      const res = await requestOrderCancellationTool.handler(toolCtx as any, {
        orderNumberOrId: 'CN-2609-0010',
        reason: 'Customer ordered duplicate by mistake',
      });

      expect(res).toEqual(
        expect.objectContaining({
          success: true,
          status: 'PENDING_APPROVAL',
          orderNumber: 'CN-2609-0010',
        }),
      );

      // Handoff was triggered
      expect(triggerHumanHandoff).toHaveBeenCalledWith(
        expect.anything(),
        WORKSPACE_A,
        CONVERSATION_ID,
        'CUSTOMER_REQUESTED',
        true,
      );
    });

    it('grounding gate blocks false cancellation confirmation when approval is only pending', () => {
      const hallucinatedReply = 'Aap ka order CN-2609-0010 cancel ho gaya hai.';

      const result = validateGrounding({
        replyText: hallucinatedReply,
        businessRules: [
          {
            category: 'ORDER_MODIFICATION',
            outcome: 'NEEDS_HUMAN',
            reason: 'Order cancellation requires human approval',
            directive: 'Do not claim cancelled',
            isDeterministic: true,
            sourceLevel: 1,
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('UNSUPPORTED_ORDER_MUTATION_CLAIM');
      expect(result.replacementReply).toContain('I cannot modify or cancel orders autonomously');
      expect(result.replacementReply).toContain('Your request has been submitted to our human team for review');
    });
  });
});
