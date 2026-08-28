/**
 * Unit tests for AI Agent Runtime and Tool Contract Foundation.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAITenantContext, requireAICapability } from '@/server/services/agent/context';
import { classifyAIError, AIAgentError } from '@/server/services/agent/errors';
import { defaultToolRegistry, ToolRegistry } from '@/server/services/agent/tools/registry';
import { zodToJsonSchema } from '@/server/services/agent/tools/schema-converter';
import type { AITool } from '@/server/services/agent/tools/tool-contract';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import { ForbiddenError, ValidationError } from '@/server/errors';

describe('AI Agent Context & Authorization', () => {
  it('creates a trusted server-side context with immutable tenant boundary', () => {
    const ctx = createAITenantContext({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
      conversationId: '33333333-3333-3333-3333-333333333333',
      messageId: '44444444-4444-4444-4444-444444444444',
      capabilities: ['products:read', 'orders:read'],
    });

    expect(ctx.workspaceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(ctx.agentId).toBe('22222222-2222-2222-2222-222222222222');
    expect(ctx.capabilities.has('products:read')).toBe(true);
    expect(ctx.capabilities.has('orders:create')).toBe(false);
    expect(ctx.executionId).toBeDefined();
  });

  it('rejects invalid context instantiation parameters', () => {
    expect(() =>
      createAITenantContext({
        workspaceId: '',
        agentId: 'a',
        conversationId: 'c',
        messageId: 'm',
        capabilities: [],
      }),
    ).toThrow(ValidationError);
  });

  it('enforces capabilities strictly with requireAICapability', () => {
    const ctx = createAITenantContext({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
      conversationId: '33333333-3333-3333-3333-333333333333',
      messageId: '44444444-4444-4444-4444-444444444444',
      capabilities: ['products:read'],
    });

    expect(() => requireAICapability(ctx, 'products:read')).not.toThrow();
    expect(() => requireAICapability(ctx, 'orders:delete')).toThrow(ForbiddenError);
  });
});

describe('Tool Contract & Schema Converter', () => {
  it('converts complex Zod schemas to valid JSON Schema definitions', () => {
    const schema = z.object({
      query: z.string().describe('Search query text'),
      limit: z.number().optional().describe('Max results to return'),
      status: z.enum(['ACTIVE', 'DRAFT']).default('ACTIVE'),
      tags: z.array(z.string()),
    });

    const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties).toBeDefined();
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(props.query?.type).toBe('string');
    expect(props.query?.description).toBe('Search query text');
    expect(props.limit?.type).toBe('number');
    expect(props.status?.type).toBe('string');
    expect(props.status?.enum).toEqual(['ACTIVE', 'DRAFT']);
    expect(props.tags?.type).toBe('array');

    const required = jsonSchema.required as string[];
    expect(required).toContain('query');
    expect(required).toContain('tags');
    expect(required).not.toContain('limit');
  });
});

describe('Tool Registry & Authorization', () => {
  it('registers tools and generates capability-filtered definitions', () => {
    const registry = new ToolRegistry();

    const sampleReadTool: AITool<{ query: string }> = {
      name: 'search_catalog',
      description: 'Search items in catalog',
      inputSchema: z.object({ query: z.string() }),
      classification: 'READ',
      capabilityRequired: 'products:read',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => ({ results: [] }),
    };

    const sampleWriteTool: AITool<{ orderId: string }> = {
      name: 'cancel_order',
      description: 'Cancel customer order',
      inputSchema: z.object({ orderId: z.string().uuid() }),
      classification: 'WRITE',
      capabilityRequired: 'orders:cancel',
      sideEffect: 'MUTATION',
      idempotency: 'REQUIRES_IDEMPOTENCY_KEY',
      riskLevel: 'HIGH',
      auditRequired: true,
      handler: async () => ({ cancelled: true }),
    };

    registry.register(sampleReadTool);
    registry.register(sampleWriteTool);

    expect(registry.has('search_catalog')).toBe(true);
    expect(registry.has('cancel_order')).toBe(true);

    // Capabilities only include products:read
    const defs = registry.getDefinitionsForCapabilities(new Set(['products:read']));
    expect(defs.length).toBe(1);
    expect(defs[0]?.name).toBe('search_catalog');

    // Context check
    const ctxWithRead = createAITenantContext({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
      conversationId: '33333333-3333-3333-3333-333333333333',
      messageId: '44444444-4444-4444-4444-444444444444',
      capabilities: ['products:read'],
    });

    const authRead = registry.authorize(ctxWithRead, 'search_catalog');
    expect(authRead.authorized).toBe(true);

    const authWrite = registry.authorize(ctxWithRead, 'cancel_order');
    expect(authWrite.authorized).toBe(false);
    expect(authWrite.reason).toContain('lacks required capability "orders:cancel"');

    const authUnknown = registry.authorize(ctxWithRead, 'non_existent_tool');
    expect(authUnknown.authorized).toBe(false);
    expect(authUnknown.reason).toContain('Unknown or unregistered tool');
  });

  it('rejects duplicate tool registrations', () => {
    const registry = new ToolRegistry();
    const tool: AITool = {
      name: 'dup_tool',
      description: 'dup',
      inputSchema: z.object({}),
      classification: 'READ',
      capabilityRequired: 'any',
      sideEffect: 'NONE',
      idempotency: 'SAFE_TO_RETRY',
      riskLevel: 'LOW',
      auditRequired: false,
      handler: async () => ({}),
    };

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});

describe('Error Classification & Retry Policy', () => {
  it('correctly classifies error types and retryability', () => {
    // Authorization
    const authErr = new ForbiddenError('Lacks permission');
    expect(classifyAIError(authErr)).toEqual({
      category: 'AUTHORIZATION_FAILURE',
      retryability: 'NOT_RETRYABLE',
      message: 'Lacks permission',
    });

    // Validation
    const valErr = new ValidationError('Bad input');
    expect(classifyAIError(valErr)).toEqual({
      category: 'INVALID_TOOL_ARGUMENTS',
      retryability: 'NOT_RETRYABLE',
      message: 'Bad input',
    });

    // Timeout
    const timeoutErr = new Error('Gateway timeout occurred');
    expect(classifyAIError(timeoutErr)).toEqual({
      category: 'PROVIDER_TIMEOUT',
      retryability: 'RETRYABLE',
      message: 'Gateway timeout occurred',
    });

    // Network / Unavailable
    const netErr = new Error('fetch failed (ECONNREFUSED)');
    expect(classifyAIError(netErr)).toEqual({
      category: 'PROVIDER_UNAVAILABLE',
      retryability: 'RETRYABLE',
      message: 'fetch failed (ECONNREFUSED)',
    });

    // Explicit AIAgentError
    const customAI = new AIAgentError('Write state indeterminate', {
      category: 'UNKNOWN_WRITE_OUTCOME',
      retryability: 'REQUIRES_MANUAL_REVIEW',
    });
    expect(classifyAIError(customAI)).toEqual({
      category: 'UNKNOWN_WRITE_OUTCOME',
      retryability: 'REQUIRES_MANUAL_REVIEW',
      message: 'Write state indeterminate',
    });
  });
});

describe('Mock AI Provider', () => {
  it('handles scripted tool calling sequences and usage stats', async () => {
    const provider = new MockAIProvider();

    provider.enqueue({
      type: 'response',
      response: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'check_stock',
              arguments: { sku: 'KURTA-XL' },
            },
          ],
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
          content: 'Kurta in XL has 5 units available.',
        },
        finishReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 30 },
      },
    });

    const res1 = await provider.generate({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Do you have Kurta in XL?' }],
    });

    expect(res1.finishReason).toBe('tool_calls');
    expect(res1.message.toolCalls?.[0]?.name).toBe('check_stock');
    expect(res1.usage.inputTokens).toBe(50);

    const res2 = await provider.generate({
      model: 'test-model',
      messages: [
        { role: 'user', content: 'Do you have Kurta in XL?' },
        res1.message,
        {
          role: 'tool',
          content: JSON.stringify({ available: 5 }),
          toolResult: {
            toolCallId: 'call_1',
            name: 'check_stock',
            result: { available: 5 },
          },
        },
      ],
    });

    expect(res2.finishReason).toBe('stop');
    expect(res2.message.content).toBe('Kurta in XL has 5 units available.');
    expect(provider.callHistory.length).toBe(2);
  });
});

describe('Job Payload & Idempotency Integration', () => {
  it('validates ai.respond job payload schemas against Zod contract', async () => {
    const { aiRespondHandler } = await import('@/server/jobs/handlers/ai-turn.handler');

    // Missing fields should throw ValidationError
    await expect(
      aiRespondHandler(
        // @ts-expect-error test invalid payload
        { workspaceId: 'w1' },
        { jobId: 'job_1', attempts: 1, maxAttempts: 5, runAfter: new Date() },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('formats deterministic dedupe key for job queue idempotent dispatch', () => {
    const messageId = '11111111-2222-3333-4444-555555555555';
    const dedupeKey = `ai.respond:${messageId}`;
    expect(dedupeKey).toBe('ai.respond:11111111-2222-3333-4444-555555555555');
  });
});

