/**
 * Integration tests for AI Agent Runtime and Telemetry.
 *
 * Runs against the PostgreSQL test database (port 5433).
 * Verifies end-to-end multi-step tool execution, telemetry (AITurn, UsageRecord),
 * counter updates, authorization, and takeover safety.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { ToolRegistry } from '@/server/services/agent/tools/registry';
import type { AITool } from '@/server/services/agent/tools/tool-contract';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import {
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

describe('AI Agent Runtime Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createConversationRow(
    workspaceId: string,
    contactId: string,
    overrides: { aiEnabled?: boolean } = {},
  ) {
    return prisma.conversation.create({
      data: {
        workspaceId,
        contactId,
        status: 'OPEN',
        aiEnabled: overrides.aiEnabled ?? true,
      },
    });
  }

  async function createMessageRow(
    workspaceId: string,
    conversationId: string,
    overrides: { direction?: 'INBOUND' | 'OUTBOUND'; body?: string } = {},
  ) {
    return prisma.message.create({
      data: {
        workspaceId,
        conversationId,
        direction: overrides.direction ?? 'INBOUND',
        status: 'RECEIVED',
        body: overrides.body ?? 'Test message',
      },
    });
  }

  async function setupAgentFixture(
    workspaceId: string,
    options: { handoffKeywords?: string[] } = {},
  ) {
    return prisma.aIAgent.create({
      data: {
        workspaceId,
        name: 'Sara Assistant',
        role: 'SALES_SUPPORT',
        isActive: true,
        isDefault: true,
        tone: 'FRIENDLY',
        languages: ['en', 'ur'],
        greeting: 'Assalam o Alaikum! How can I help you today?',
        persona: 'Polite and helpful customer support representative.',
        customInstructions: 'Help customers with product inquiries.',
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxOutputTokens: 500,
        confidenceFloor: 0.45,
        handoffKeywords: options.handoffKeywords ?? ['human', 'agent', 'operator'],
        instructions: {
          create: [
            {
              workspaceId,
              title: 'Pricing Policy',
              content: 'All prices are in PKR and include applicable taxes.',
              position: 0,
              isActive: true,
            },
          ],
        },
      },
    });
  }

  it('executes complete multi-step tool loop and records AITurn + UsageRecord telemetry', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const agent = await setupAgentFixture(workspaceId);
    const contact = await createContactFixture(workspaceId, { name: 'Usman Ali', phoneE164: '+923001112233' });
    const conversation = await createConversationRow(workspaceId, contact.id);
    const message = await createMessageRow(workspaceId, conversation.id, {
      direction: 'INBOUND',
      body: 'Do you have Blue Kurta in Medium?',
    });

    // Custom tool registry with a sample inventory check tool
    const customRegistry = new ToolRegistry();
    let toolExecutionCount = 0;

    const checkStockTool: AITool<{ sku: string }> = {
      name: 'check_inventory',
      description: 'Check item inventory by SKU',
      inputSchema: z.object({ sku: z.string() }),
      classification: 'READ',
      capabilityRequired: 'inventory:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async (ctx, input) => {
        toolExecutionCount++;
        // Verify server context
        expect(ctx.workspaceId).toBe(workspaceId);
        expect(ctx.agentId).toBe(agent.id);
        expect(ctx.messageId).toBe(message.id);
        return { sku: input.sku, inStock: true, available: 4 };
      },
    };

    customRegistry.register(checkStockTool);

    // Mock Provider with 2 steps: Tool Call -> Final Response
    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_abc_1',
              name: 'check_inventory',
              arguments: { sku: 'KURTA-BLU-M' },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 100, outputTokens: 25 },
      },
    });

    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'Yes, we have 4 units of Blue Kurta in Medium available!',
        },
        finishReason: 'stop',
        usage: { inputTokens: 150, outputTokens: 35 },
      },
    });

    // Execute
    const result = await executeAgentTurn({
      db: prisma,
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider,
      toolRegistry: customRegistry,
      customCapabilities: ['inventory:read'],
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.replyText).toBe('Yes, we have 4 units of Blue Kurta in Medium available!');
    expect(result.handoffTriggered).toBe(false);
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe('check_inventory');
    expect(result.toolCalls[0]?.isError).toBe(false);
    expect(toolExecutionCount).toBe(1);
    expect(result.inputTokens).toBe(250); // 100 + 150
    expect(result.outputTokens).toBe(60); // 25 + 35

    // Verify AITurn persistence in database
    const savedTurn = await prisma.aITurn.findUnique({
      where: { id: result.turnId },
    });
    expect(savedTurn).not.toBeNull();
    expect(savedTurn?.workspaceId).toBe(workspaceId);
    expect(savedTurn?.conversationId).toBe(conversation.id);
    expect(savedTurn?.messageId).toBe(message.id);
    expect(savedTurn?.agentId).toBe(agent.id);
    expect(savedTurn?.outputText).toBe('Yes, we have 4 units of Blue Kurta in Medium available!');
    expect(savedTurn?.inputTokens).toBe(250);
    expect(savedTurn?.outputTokens).toBe(60);
    expect(savedTurn?.groundingPassed).toBe(true);

    // Verify UsageRecord persistence in database
    const usageRecords = await prisma.usageRecord.findMany({
      where: { workspaceId, messageId: message.id },
    });
    expect(usageRecords.length).toBe(3); // AI_REQUEST, AI_INPUT_TOKENS, AI_OUTPUT_TOKENS
    const reqRecord = usageRecords.find((r) => r.metric === 'AI_REQUEST');
    const inTokensRecord = usageRecords.find((r) => r.metric === 'AI_INPUT_TOKENS');
    const outTokensRecord = usageRecords.find((r) => r.metric === 'AI_OUTPUT_TOKENS');

    expect(reqRecord?.quantity).toBe(1);
    expect(inTokensRecord?.quantity).toBe(250);
    expect(outTokensRecord?.quantity).toBe(60);

    // Verify Agent counter increment
    const updatedAgent = await prisma.aIAgent.findUnique({
      where: { id: agent.id },
    });
    expect(updatedAgent?.conversationsHandled).toBe(1);
  });

  it('protects against repeated tool-call loops by enforcing repetition limits', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await setupAgentFixture(workspaceId);
    const contact = await createContactFixture(workspaceId);
    const conversation = await createConversationRow(workspaceId, contact.id);
    const message = await createMessageRow(workspaceId, conversation.id, {
      direction: 'INBOUND',
      body: 'Check stock again and again',
    });

    const registry = new ToolRegistry();
    let callCount = 0;
    registry.register({
      name: 'infinite_probe',
      description: 'Test tool',
      inputSchema: z.object({ id: z.string() }),
      classification: 'READ',
      capabilityRequired: 'products:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => {
        callCount++;
        return { status: 'retry' };
      },
    });

    // Provider that endlessly tries the exact same tool call
    const provider = new MockAIProvider();
    for (let i = 0; i < 6; i++) {
      provider.enqueue({
        type: 'response',
        response: {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: `call_${i}`, name: 'infinite_probe', arguments: { id: 'fixed' } }],
          },
          finishReason: 'tool_calls',
          usage: { inputTokens: 20, outputTokens: 10 },
        },
      });
    }

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider,
      toolRegistry: registry,
      customCapabilities: ['products:read'],
      maxRepeatedToolCalls: 2,
    });

    // Should stop executing the tool handler after 2 attempts
    expect(callCount).toBe(2);
    // At attempt 3, tool returns REPEATED_TOOL_INVOCATION_LIMIT error
    expect(provider.callHistory.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects tool calls when AI lacks required capability', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await setupAgentFixture(workspaceId);
    const contact = await createContactFixture(workspaceId);
    const conversation = await createConversationRow(workspaceId, contact.id);
    const message = await createMessageRow(workspaceId, conversation.id, {
      direction: 'INBOUND',
      body: 'Can you refund my order?',
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'refund_order',
      description: 'Refund order amount',
      inputSchema: z.object({ orderId: z.string() }),
      classification: 'WRITE',
      capabilityRequired: 'orders:refund', // NOT GRANTED
      sideEffect: 'MUTATION',
      idempotency: 'REQUIRES_IDEMPOTENCY_KEY',
      riskLevel: 'HIGH',
      auditRequired: true,
      handler: async () => ({ refunded: true }),
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_refund', name: 'refund_order', arguments: { orderId: 'ord_1' } }],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 50, outputTokens: 20 },
      },
    });

    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: 'I cannot process refunds directly. Let me connect you with our team.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 20 },
      },
    });

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider,
      toolRegistry: registry,
      customCapabilities: ['products:read'], // Missing orders:refund!
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.replyText).toContain('connect you with our team');

    // The toolResult fed back to the model should contain authorization failure
    const toolMsg = provider.callHistory[1]?.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Authorization error');
  });

  it('aborts immediately and suppresses outbound send if human takeover is active', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await setupAgentFixture(workspaceId);
    const contact = await createContactFixture(workspaceId);
    // Create conversation with aiEnabled: false
    const conversation = await createConversationRow(workspaceId, contact.id, { aiEnabled: false });
    const message = await createMessageRow(workspaceId, conversation.id, {
      direction: 'INBOUND',
      body: 'Hello human agent',
    });

    const provider = new MockAIProvider();
    provider.enqueue({
      type: 'response',
      response: {
        message: { role: 'assistant', content: 'AI should not answer this' },
        finishReason: 'stop',
      },
    });

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider,
    });

    expect(result.status).toBe('ABORTED');
    expect(result.replyText).toBeNull();
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('MANUAL_TAKEOVER');
    expect(provider.callHistory.length).toBe(0); // Provider was never called
  });

  it('detects handoff keywords in customer message and triggers handoff without calling model', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await setupAgentFixture(workspaceId, { handoffKeywords: ['human', 'agent', 'representative'] });
    const contact = await createContactFixture(workspaceId);
    const conversation = await createConversationRow(workspaceId, contact.id);
    const message = await createMessageRow(workspaceId, conversation.id, {
      direction: 'INBOUND',
      body: 'I want to speak with a real human please',
    });

    const provider = new MockAIProvider();

    const result = await executeAgentTurn({
      db: prisma,
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider,
    });

    expect(result.status).toBe('HANDOFF');
    expect(result.replyText).toBeNull();
    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBe('CUSTOMER_REQUESTED');
    expect(provider.callHistory.length).toBe(0); // Bypassed model generation
  });
});
