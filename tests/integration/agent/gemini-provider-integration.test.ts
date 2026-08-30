import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db/prisma';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { defaultToolRegistry } from '@/server/services/agent/tools/registry';
import { GeminiProvider } from '@/services/ai/providers/gemini-provider';
import { createContactFixture, createWorkspaceFixture, resetDatabase } from '../fixtures';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      let callCount = 0;
      return {
        models: {
          generateContent: vi.fn().mockImplementation(async (req: any) => {
            callCount++;
            
            // First call: The model decides to search for products
            if (callCount === 1) {
              return {
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          functionCall: {
                            name: 'search_products',
                            args: { query: 'Kurta', limit: 3 },
                          },
                        },
                      ],
                    },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
              };
            }
            
            // Second call: The model sees the tool result and answers the user
            if (callCount === 2) {
              return {
                candidates: [
                  {
                    content: {
                      parts: [{ text: 'We have 2 Kurtas available.' }],
                    },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
              };
            }
          }),
        },
      };
    }),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
    },
  };
});

describe('Gemini Provider Integration with Agent Runtime', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('executes a full tool-call loop with Gemini Provider', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    const contact = await createContactFixture(workspaceId);
    
    // Create actual test data so the real tool returns data
    await prisma.product.create({
      data: {
        workspaceId,
        name: 'Summer Kurta',
        slug: 'summer-kurta',
        status: 'ACTIVE',
        priceMinor: 5000,
        currency: 'PKR',
      }
    });

    await prisma.product.create({
      data: {
        workspaceId,
        name: 'Winter Kurta',
        slug: 'winter-kurta',
        status: 'ACTIVE',
        priceMinor: 6000,
        currency: 'PKR',
      }
    });

    const conversation = await prisma.conversation.create({
      data: { workspaceId, contactId: contact.id, status: 'OPEN', aiEnabled: true },
    });
    
    const message = await prisma.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: 'Do you have any Kurtas?',
      },
    });

    await prisma.aIAgent.create({
      data: {
        workspaceId,
        name: 'Gemini Sales Rep',
        role: 'SALES',
        isActive: true,
        isDefault: true,
        model: 'gemini-1.5-pro',
      },
    });

    const geminiProvider = new GeminiProvider();

    const result = await executeAgentTurn({
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      provider: geminiProvider,
      toolRegistry: defaultToolRegistry,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.replyText).toBe('We have 2 Kurtas available.');
    
    // The runtime should have recorded the actual execution of the tool
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('search_products');
    expect(result.toolCalls[0]?.isError).toBe(false);
    
    const toolResult = result.toolCalls[0]?.result as any;
    expect(toolResult?.results).toHaveLength(2);
    const names = toolResult?.results.map((r: any) => r.name);
    expect(names).toContain('Summer Kurta');
    expect(names).toContain('Winter Kurta');
    
    // Total tokens should be the sum from all iterations (10+5) + (30+10) = 55 tokens used.
    expect(result.inputTokens).toBe(40);
    expect(result.outputTokens).toBe(15);
  });
});
