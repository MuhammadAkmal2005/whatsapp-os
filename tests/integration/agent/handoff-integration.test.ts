import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { prisma } from '@/db/prisma';
import { createWorkspaceFixture, createContactFixture } from '../fixtures';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import { ToolRegistry } from '@/server/services/agent/tools/registry';
import { z } from 'zod';

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

async function createMessageRow(
  workspaceId: string,
  conversationId: string,
  overrides?: any
) {
  return prisma.message.create({
    data: {
      workspaceId,
      conversationId,
      direction: 'INBOUND',
      type: 'TEXT',
      body: overrides?.body ?? 'Hello',
      occurredAt: new Date(),
      providerMessageId: `msg_${Date.now()}_${Math.random()}`,
      status: 'DELIVERED',
      ...overrides,
    },
  });
}
import { AIAgentError } from '@/server/services/agent/errors';

describe('Phase 5 Unit 6: Human Handoff Orchestration Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  async function setupAgentFixture(workspaceId: string, options: { handoffKeywords?: string[] } = {}) {
    return prisma.aIAgent.create({
      data: {
        workspaceId,
        name: 'Handoff Test Agent',
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        maxOutputTokens: 500,
        handoffKeywords: options.handoffKeywords ?? ['human', 'agent'],
        instructions: {
          create: [{ title: 'Role', content: 'You are an agent.', position: 1, workspaceId }],
        },
      },
    });
  }

  it('1. AI explicitly triggers handoff on repeated tool failures, disables AI, and creates notification', async () => {
    const ws = await createWorkspaceFixture();
    await setupAgentFixture(ws.workspaceId);
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationRow(ws.workspaceId, contact.id);
    const msg = await createMessageRow(ws.workspaceId, conv.id, { body: 'Run failing tool' });

    const provider = new MockAIProvider();
    const registry = new ToolRegistry();
    const failingHandler = vi.fn().mockResolvedValue({ success: false });

    registry.register({
      name: 'failing_tool',
      description: 'Fails',
      classification: 'READ',
      sideEffect: 'NONE',
      capabilityRequired: 'products:read',
      idempotency: 'SAFE_TO_RETRY',
      auditRequired: false,
      riskLevel: 'LOW',
      inputSchema: z.object({}),
      handler: failingHandler,
    });

    // Enqueue 4 tool calls. Max repeated is 3, so 4th triggers handoff.
    for (let i = 0; i < 4; i++) {
      provider.enqueue({
        type: 'response',
        response: {
          message: { role: 'assistant', content: '', toolCalls: [{ id: `tc${i}`, name: 'failing_tool', arguments: {} }] },
          finishReason: 'tool_calls',
        }
      });
    }

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId: ws.workspaceId,
      conversationId: conv.id,
      messageId: msg.id,
      provider,
      toolRegistry: registry,
      customCapabilities: ['products:read'],
      maxRepeatedToolCalls: 3,
    });

    expect(result.status).toBe('FAILED');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('AI_ERROR');
    expect(result.errorCategory).toBe('RESOURCE_LIMIT_EXCEEDED');

    // DB Verification
    const updatedConv = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(updatedConv.aiEnabled).toBe(false);
    expect(updatedConv.handoffReason).toBe('AI_ERROR');

    const notifs = await prisma.notification.findMany({ where: { workspaceId: ws.workspaceId, resourceId: conv.id } });
    expect(notifs.length).toBe(1);
    expect(notifs[0]?.type).toBe('HUMAN_HANDOFF');

    const audits = await prisma.auditLog.findMany({ where: { resourceId: conv.id, action: 'CONVERSATION_HANDOFF' } });
    expect(audits.length).toBe(1);
  });

  it('2. Unknown write outcome forces handoff safely', async () => {
    const ws = await createWorkspaceFixture();
    await setupAgentFixture(ws.workspaceId);
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await createConversationRow(ws.workspaceId, contact.id);
    const msg = await createMessageRow(ws.workspaceId, conv.id, { body: 'Trigger unknown write' });

    const provider = new MockAIProvider();
    const registry = new ToolRegistry();
    
    registry.register({
      name: 'uncertain_tool',
      description: 'Mutates uncertainly',
      classification: 'WRITE',
      sideEffect: 'MUTATION',
      capabilityRequired: 'orders:create',
      idempotency: 'REQUIRES_IDEMPOTENCY_KEY',
      auditRequired: false,
      riskLevel: 'HIGH',
      inputSchema: z.object({}),
      handler: vi.fn().mockRejectedValue(new AIAgentError('Uncertain outcome', { category: 'UNKNOWN_WRITE_OUTCOME', retryability: 'REQUIRES_MANUAL_REVIEW' })),
    });

    provider.enqueue({
      type: 'response',
      response: {
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'tc', name: 'uncertain_tool', arguments: {} }] },
        finishReason: 'tool_calls',
      }
    });

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId: ws.workspaceId,
      conversationId: conv.id,
      messageId: msg.id,
      provider,
      toolRegistry: registry,
      customCapabilities: ['orders:create'],
    });

    expect(result.status).toBe('FAILED');
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('AI_ERROR');
    expect(result.errorCategory).toBe('UNKNOWN_WRITE_OUTCOME');
  });
});
