import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '@/services/ai/providers/gemini-provider';
import { AIAgentError } from '@/server/services/agent/errors';
import { Type } from '@google/genai';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Mocked Gemini response' }]
                },
                finishReason: 'STOP'
              }
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5
            }
          })
        }
      };
    }),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY'
    }
  };
});

describe('GeminiProvider', () => {
  it('throws if no API key is provided and none in env', () => {
    expect(() => new GeminiProvider('')).toThrow('GeminiProvider requires an API key');
  });

  it('correctly maps system messages to systemInstruction', async () => {
    const provider = new GeminiProvider('test-key');
    
    // We get access to the mocked generateContent
    const mockGenerateContent = (provider as any).ai.models.generateContent;
    
    await provider.generate({
      model: 'gemini-1.5-flash',
      messages: [
        { role: 'system', content: 'You are a test bot.' },
        { role: 'user', content: 'Hello' }
      ]
    });
    
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-1.5-flash',
      contents: [
        { role: 'user', parts: [{ text: '[USER_MESSAGE]\nHello\n[/USER_MESSAGE]' }] }
      ],
      config: expect.objectContaining({
        systemInstruction: 'You are a test bot.'
      })
    });
  });

  it('maps tool responses correctly', async () => {
    const provider = new GeminiProvider('test-key');
    const mockGenerateContent = (provider as any).ai.models.generateContent;

    await provider.generate({
      model: 'gemini-1.5-flash',
      messages: [
        { role: 'user', content: 'check stock' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'check_inventory', arguments: { productId: '123' } }]
        },
        {
          role: 'tool',
          content: '{"available":5}',
          toolResult: { toolCallId: 'call_1', name: 'check_inventory', result: { available: 5 } }
        }
      ]
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          { role: 'user', parts: [{ text: '[USER_MESSAGE]\ncheck stock\n[/USER_MESSAGE]' }] },
          { role: 'model', parts: [{ functionCall: { name: 'check_inventory', args: { productId: '123' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'check_inventory', response: { available: 5 } } }] }
        ]
      })
    );
  });

  it('handles safety blocks by throwing AIAgentError', async () => {
    const provider = new GeminiProvider('test-key');
    const mockGenerateContent = (provider as any).ai.models.generateContent;

    mockGenerateContent.mockResolvedValue({
      candidates: [
        { finishReason: 'SAFETY', content: { parts: [] } }
      ]
    });

    const promise = provider.generate({
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'bad query' }]
    });

    await expect(promise).rejects.toThrowError(AIAgentError);
    await expect(promise).rejects.toMatchObject({ category: 'SAFETY_POLICY_VIOLATION', retryability: 'NOT_RETRYABLE' });
  });

  it('maps API rate limits to RATE_LIMITED error', async () => {
    const provider = new GeminiProvider('test-key');
    const mockGenerateContent = (provider as any).ai.models.generateContent;

    mockGenerateContent.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    await expect(provider.generate({
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'hello' }]
    })).rejects.toMatchObject({ category: 'RATE_LIMITED', retryability: 'RETRYABLE' });
  });

  it('maps unauthorized to AUTHORIZATION_FAILURE error', async () => {
    const provider = new GeminiProvider('test-key');
    const mockGenerateContent = (provider as any).ai.models.generateContent;

    mockGenerateContent.mockRejectedValueOnce(new Error('403 API key not valid'));

    await expect(provider.generate({
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'hello' }]
    })).rejects.toMatchObject({ category: 'AUTHORIZATION_FAILURE', retryability: 'NOT_RETRYABLE' });
  });
  
  it('maps tool schemas correctly', async () => {
    const provider = new GeminiProvider('test-key');
    const mockGenerateContent = (provider as any).ai.models.generateContent;

    await provider.generate({
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          name: 'get_product',
          description: 'Get product',
          inputSchema: {
            type: 'object',
            properties: {
              productId: { type: 'string' }
            },
            required: ['productId']
          }
        }
      ]
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'get_product',
                  description: 'Get product',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      productId: { type: 'STRING' }
                    },
                    required: ['productId']
                  }
                }
              ]
            }
          ]
        })
      })
    );
  });
});
