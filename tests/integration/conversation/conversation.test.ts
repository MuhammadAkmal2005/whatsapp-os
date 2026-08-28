/**
 * Conversation and Message integration tests.
 *
 * Verifies multi-tenant conversation and message operations against a real PostgreSQL database:
 * - Conversation creation with contact association and participant tracking
 * - Conversation retrieval and listing with status, priority, and assignment filters
 * - Conversation lifecycle & status transitions (OPEN -> PENDING -> RESOLVED -> CLOSED)
 * - Assigning conversations to workspace members and unassigning
 * - AI toggle controls and handoff reasons
 * - Inbound and outbound message creation with sender tracking
 * - Message listing with attachments and cursor pagination
 * - Monotonic message status transitions (QUEUED -> SENT -> DELIVERED -> READ)
 * - Strict cross-tenant isolation (Workspace B cannot access Workspace A threads/messages)
 * - Role-based authorization & permission enforcement (VIEWER, AGENT, OWNER)
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import {
  assignConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  toggleConversationAi,
  updateConversationPriority,
  updateConversationStatus,
} from '@/server/services/conversation/conversation.service';
import {
  getMessage,
  listMessages,
  sendMessage,
  updateMessageStatus,
} from '@/server/services/conversation/message.service';
import type {
  CreateConversationInput,
  SendMessageInput,
} from '@/server/validation/conversation';
import {
  createContactFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

describe('Conversation and Message integration tests', () => {
  let workspaceA: WorkspaceFixture;
  let workspaceB: WorkspaceFixture;

  beforeEach(async () => {
    await resetDatabase();
    workspaceA = await createWorkspaceFixture({ name: 'Akmal Apparel' });
    workspaceB = await createWorkspaceFixture({ name: 'Lahore Gadgets' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Conversation creation and retrieval', () => {
    it('creates a conversation for a contact and retrieves detail with participants', async () => {
      const contact = await createContactFixture(workspaceA.workspaceId, {
        name: 'Fatima Sheikh',
        phoneE164: '+923001234567',
      });

      const input: CreateConversationInput = {
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
        priority: 'NORMAL',
        initialMessage: {
          body: 'Hello, I would like to inquire about the lawn suit.',
          type: 'TEXT',
        },
      };

      const created = await createConversation(workspaceA.context, input);
      expect(created.id).toBeDefined();
      expect(created.contactId).toBe(contact.id);
      expect(created.contact.name).toBe('Fatima Sheikh');
      expect(created.status).toBe('OPEN');
      expect(created.priority).toBe('NORMAL');
      expect(created.aiEnabled).toBe(true);

      // Verify participant was automatically created for the contact
      expect(created.participants.some((p) => p.contactId === contact.id)).toBe(true);

      // Verify initial message was inserted
      const messages = await listMessages(workspaceA.context, {
        conversationId: created.id,
        limit: 10,
      });
      expect(messages.rows).toHaveLength(1);
      expect(messages.rows[0]?.body).toBe('Hello, I would like to inquire about the lawn suit.');
      expect(messages.rows[0]?.direction).toBe('OUTBOUND');

      // Verify retrieve by ID
      const fetched = await getConversation(workspaceA.context, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.contact.phoneE164).toBe('+923001234567');
    });

    it('lists conversations with filters, search, and status counts', async () => {
      const contact1 = await createContactFixture(workspaceA.workspaceId, {
        name: 'Zainab Bibi',
        phoneE164: '+923001112233',
      });
      const contact2 = await createContactFixture(workspaceA.workspaceId, {
        name: 'Bilal Khan',
        phoneE164: '+923004445566',
      });

      await createConversation(workspaceA.context, {
        contactId: contact1.id,
        status: 'OPEN',
        priority: 'HIGH',
      });

      await createConversation(workspaceA.context, {
        contactId: contact2.id,
        status: 'RESOLVED',
        priority: 'NORMAL',
      });

      // List all
      const listAll = await listConversations(workspaceA.context, { limit: 20 });
      expect(listAll.conversations).toHaveLength(2);
      expect(listAll.statusCounts['OPEN']).toBe(1);
      expect(listAll.statusCounts['RESOLVED']).toBe(1);
      expect(listAll.total).toBe(2);

      // Filter by status
      const listOpen = await listConversations(workspaceA.context, {
        status: 'OPEN',
        limit: 20,
      });
      expect(listOpen.conversations).toHaveLength(1);
      expect(listOpen.conversations[0]?.contact.name).toBe('Zainab Bibi');

      // Search by contact name
      const searchResult = await listConversations(workspaceA.context, {
        search: 'Bilal',
        limit: 20,
      });
      expect(searchResult.conversations).toHaveLength(1);
      expect(searchResult.conversations[0]?.contact.name).toBe('Bilal Khan');
    });
  });

  describe('Conversation status and assignment lifecycle', () => {
    it('transitions conversation status and records resolution timestamps', async () => {
      const contact = await createContactFixture(workspaceA.workspaceId);
      const conversation = await createConversation(workspaceA.context, {
        contactId: contact.id,
        status: 'OPEN',
      });

      // Move to PENDING
      const pending = await updateConversationStatus(workspaceA.context, {
        conversationId: conversation.id,
        status: 'PENDING',
      });
      expect(pending.status).toBe('PENDING');

      // Move to RESOLVED (sets resolvedAt)
      const resolved = await updateConversationStatus(workspaceA.context, {
        conversationId: conversation.id,
        status: 'RESOLVED',
      });
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolvedAt).not.toBeNull();

      // Move to CLOSED (sets closedAt)
      const closed = await updateConversationStatus(workspaceA.context, {
        conversationId: conversation.id,
        status: 'CLOSED',
      });
      expect(closed.status).toBe('CLOSED');
      expect(closed.closedAt).not.toBeNull();
    });

    it('assigns conversation to a team member and updates participants', async () => {
      const agentMember = await createMemberFixture(workspaceA.workspaceId, 'AGENT', {
        name: 'Support Agent Ali',
      });
      const contact = await createContactFixture(workspaceA.workspaceId);
      const conversation = await createConversation(workspaceA.context, {
        contactId: contact.id,
      });

      // Assign to agent
      const assigned = await assignConversation(workspaceA.context, {
        conversationId: conversation.id,
        assignedToMemberId: agentMember.membershipId,
      });
      expect(assigned.assignedToMemberId).toBe(agentMember.membershipId);
      expect(assigned.assignedTo?.user.name).toBe('Support Agent Ali');
      expect(assigned.participants.some((p) => p.memberId === agentMember.membershipId)).toBe(true);

      // Unassign
      const unassigned = await assignConversation(workspaceA.context, {
        conversationId: conversation.id,
        assignedToMemberId: null,
      });
      expect(unassigned.assignedToMemberId).toBeNull();
    });

    it('updates priority and toggles AI handoff settings', async () => {
      const contact = await createContactFixture(workspaceA.workspaceId);
      const conversation = await createConversation(workspaceA.context, {
        contactId: contact.id,
      });

      // Update priority
      const highPri = await updateConversationPriority(workspaceA.context, {
        conversationId: conversation.id,
        priority: 'URGENT',
      });
      expect(highPri.priority).toBe('URGENT');

      // Toggle AI off (human handoff)
      const pausedAi = await toggleConversationAi(workspaceA.context, {
        conversationId: conversation.id,
        aiEnabled: false,
        handoffReason: 'CUSTOMER_REQUESTED',
      });
      expect(pausedAi.aiEnabled).toBe(false);
      expect(pausedAi.aiPausedAt).not.toBeNull();
      expect(pausedAi.handoffReason).toBe('CUSTOMER_REQUESTED');
      expect(pausedAi.handoffAt).not.toBeNull();

      // Toggle AI back on
      const resumedAi = await toggleConversationAi(workspaceA.context, {
        conversationId: conversation.id,
        aiEnabled: true,
      });
      expect(resumedAi.aiEnabled).toBe(true);
      expect(resumedAi.aiPausedAt).toBeNull();
      expect(resumedAi.handoffReason).toBeNull();
    });
  });

  describe('Messages and attachments', () => {
    it('sends inbound and outbound messages and touches conversation activity metrics', async () => {
      const contact = await createContactFixture(workspaceA.workspaceId);
      const conversation = await createConversation(workspaceA.context, {
        contactId: contact.id,
      });

      // Customer sends inbound message
      const inboundInput: SendMessageInput = {
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: 'TEXT',
        body: 'Do you have medium size in stock?',
        status: 'RECEIVED',
        attachments: [],
      };
      const inboundMsg = await sendMessage(workspaceA.context, inboundInput);
      expect(inboundMsg.id).toBeDefined();
      expect(inboundMsg.direction).toBe('INBOUND');
      expect(inboundMsg.status).toBe('RECEIVED');
      expect(inboundMsg.senderContactId).toBe(contact.id);

      // Agent replies with outbound message and image attachment
      const outboundInput: SendMessageInput = {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'IMAGE',
        body: 'Yes! Here is the size chart.',
        status: 'SENT',
        attachments: [
          {
            kind: 'IMAGE',
            mimeType: 'image/jpeg',
            fileName: 'size-chart.jpg',
            byteSize: 102400,
            storageKey: 'attachments/size-chart-uuid.jpg',
          },
        ],
      };
      const outboundMsg = await sendMessage(workspaceA.context, outboundInput);
      expect(outboundMsg.id).toBeDefined();
      expect(outboundMsg.direction).toBe('OUTBOUND');
      expect(outboundMsg.attachments).toHaveLength(1);
      expect(outboundMsg.attachments[0]?.fileName).toBe('size-chart.jpg');

      // Verify conversation activity was touched
      const updatedConv = await getConversation(workspaceA.context, conversation.id);
      expect(updatedConv.messageCount).toBe(2);
      expect(updatedConv.lastMessageAt).not.toBeNull();
      expect(updatedConv.firstResponseAt).not.toBeNull(); // recorded on first outbound response

      // List messages
      const thread = await listMessages(workspaceA.context, {
        conversationId: conversation.id,
        limit: 10,
      });
      expect(thread.rows).toHaveLength(2);
    });

    it('advances message status monotonically without regressing', async () => {
      const contact = await createContactFixture(workspaceA.workspaceId);
      const conversation = await createConversation(workspaceA.context, {
        contactId: contact.id,
      });

      const message = await sendMessage(workspaceA.context, {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body: 'Your tracking number is 98765.',
        status: 'QUEUED',
        attachments: [],
      });
      expect(message.status).toBe('QUEUED');

      // QUEUED -> SENT
      const sent = await updateMessageStatus(workspaceA.context, {
        messageId: message.id,
        status: 'SENT',
      });
      expect(sent.status).toBe('SENT');
      expect(sent.sentAt).not.toBeNull();

      // SENT -> DELIVERED
      const delivered = await updateMessageStatus(workspaceA.context, {
        messageId: message.id,
        status: 'DELIVERED',
      });
      expect(delivered.status).toBe('DELIVERED');
      expect(delivered.deliveredAt).not.toBeNull();

      // DELIVERED -> READ
      const read = await updateMessageStatus(workspaceA.context, {
        messageId: message.id,
        status: 'READ',
      });
      expect(read.status).toBe('READ');
      expect(read.readAt).not.toBeNull();

      // Out of order callback: try to set DELIVERED after READ (should remain READ)
      const afterLateCallback = await updateMessageStatus(workspaceA.context, {
        messageId: message.id,
        status: 'DELIVERED',
      });
      expect(afterLateCallback.status).toBe('READ');
    });
  });

  describe('Cross-tenant isolation', () => {
    it('prevents Workspace B from reading Workspace A conversations or messages', async () => {
      const contactA = await createContactFixture(workspaceA.workspaceId, {
        name: 'Secret Client A',
      });
      const convA = await createConversation(workspaceA.context, {
        contactId: contactA.id,
        initialMessage: { body: 'Confidential order inquiry', type: 'TEXT' },
      });

      // Workspace B cannot get conversation A by ID
      await expect(getConversation(workspaceB.context, convA.id)).rejects.toThrow(NotFoundError);

      // Workspace B listing does not include conversation A
      const listB = await listConversations(workspaceB.context, { limit: 20 });
      expect(listB.conversations.find((c) => c.id === convA.id)).toBeUndefined();

      // Workspace B cannot list messages in conversation A
      await expect(
        listMessages(workspaceB.context, { conversationId: convA.id, limit: 10 }),
      ).rejects.toThrow(NotFoundError);
    });

    it('prevents Workspace B from modifying or sending messages to Workspace A conversations', async () => {
      const contactA = await createContactFixture(workspaceA.workspaceId);
      const convA = await createConversation(workspaceA.context, {
        contactId: contactA.id,
      });

      // Workspace B cannot update status
      await expect(
        updateConversationStatus(workspaceB.context, {
          conversationId: convA.id,
          status: 'CLOSED',
        }),
      ).rejects.toThrow(NotFoundError);

      // Workspace B cannot assign conversation
      await expect(
        assignConversation(workspaceB.context, {
          conversationId: convA.id,
          assignedToMemberId: null,
        }),
      ).rejects.toThrow(NotFoundError);

      // Workspace B cannot send message in conversation A
      await expect(
        sendMessage(workspaceB.context, {
          conversationId: convA.id,
          direction: 'OUTBOUND',
          body: 'Malicious injected message',
          attachments: [],
        }),
      ).rejects.toThrow(NotFoundError);

      // Workspace B cannot delete conversation A
      await expect(
        deleteConversation(workspaceB.context, {
          conversationId: convA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects cross-tenant contact references when creating conversations', async () => {
      const contactInB = await createContactFixture(workspaceB.workspaceId);

      // Workspace A tries to start conversation with Workspace B contact
      await expect(
        createConversation(workspaceA.context, {
          contactId: contactInB.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Authorization and permissions', () => {
    it('enforces RBAC permissions on conversation actions', async () => {
      const viewerMember = await createMemberFixture(workspaceA.workspaceId, 'VIEWER', {
        name: 'Readonly Viewer',
      });

      const viewerCtx = tenantContextFor({
        workspaceId: workspaceA.workspaceId,
        workspaceSlug: workspaceA.workspaceSlug,
        workspaceName: 'Akmal Apparel',
        currency: 'PKR',
        userId: viewerMember.userId,
        userName: viewerMember.name,
        userEmail: viewerMember.email,
        membershipId: viewerMember.membershipId,
        role: 'VIEWER',
      });

      const contact = await createContactFixture(workspaceA.workspaceId);

      // VIEWER cannot create conversation
      await expect(
        createConversation(viewerCtx, { contactId: contact.id }),
      ).rejects.toThrow(ForbiddenError);

      // Create conversation as OWNER
      const conv = await createConversation(workspaceA.context, { contactId: contact.id });

      // VIEWER can read conversation
      const readDetail = await getConversation(viewerCtx, conv.id);
      expect(readDetail.id).toBe(conv.id);

      // VIEWER cannot reply/send message
      await expect(
        sendMessage(viewerCtx, {
          conversationId: conv.id,
          direction: 'OUTBOUND',
          body: 'Unauthorized reply from viewer',
          attachments: [],
        }),
      ).rejects.toThrow(ForbiddenError);

      // VIEWER cannot change status
      await expect(
        updateConversationStatus(viewerCtx, {
          conversationId: conv.id,
          status: 'RESOLVED',
        }),
      ).rejects.toThrow(ForbiddenError);

      // VIEWER cannot assign conversation
      await expect(
        assignConversation(viewerCtx, {
          conversationId: conv.id,
          assignedToMemberId: viewerMember.membershipId,
        }),
      ).rejects.toThrow(ForbiddenError);

      // VIEWER cannot toggle AI
      await expect(
        toggleConversationAi(viewerCtx, {
          conversationId: conv.id,
          aiEnabled: false,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('scopes AGENT listing to assigned conversations when conversation:read_all is absent', async () => {
      const agent1 = await createMemberFixture(workspaceA.workspaceId, 'AGENT', {
        name: 'Agent One',
      });
      const agent2 = await createMemberFixture(workspaceA.workspaceId, 'AGENT', {
        name: 'Agent Two',
      });

      const agent1Ctx = tenantContextFor({
        workspaceId: workspaceA.workspaceId,
        workspaceSlug: workspaceA.workspaceSlug,
        workspaceName: 'Akmal Apparel',
        currency: 'PKR',
        userId: agent1.userId,
        userName: agent1.name,
        userEmail: agent1.email,
        membershipId: agent1.membershipId,
        role: 'AGENT',
      });

      const contact1 = await createContactFixture(workspaceA.workspaceId, { name: 'Client 1' });
      const contact2 = await createContactFixture(workspaceA.workspaceId, { name: 'Client 2' });

      // Conv 1 assigned to Agent 1
      const conv1 = await createConversation(workspaceA.context, {
        contactId: contact1.id,
        assignedToMemberId: agent1.membershipId,
      });

      // Conv 2 assigned to Agent 2
      const conv2 = await createConversation(workspaceA.context, {
        contactId: contact2.id,
        assignedToMemberId: agent2.membershipId,
      });

      // Agent 1 listing only returns Conv 1
      const agent1List = await listConversations(agent1Ctx, { limit: 20 });
      expect(agent1List.conversations.some((c) => c.id === conv1.id)).toBe(true);
      expect(agent1List.conversations.some((c) => c.id === conv2.id)).toBe(false);

      // Agent 1 can read Conv 1
      const readConv1 = await getConversation(agent1Ctx, conv1.id);
      expect(readConv1.id).toBe(conv1.id);

      // Agent 1 cannot read unassigned/other Agent's Conv 2
      await expect(getConversation(agent1Ctx, conv2.id)).rejects.toThrow(NotFoundError);
    });
  });
});
