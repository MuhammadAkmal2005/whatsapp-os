import 'server-only';

import { GoogleGenAI, Type } from '@google/genai';
import { env } from '@/config/env';
import {
  AIAgentError,
  classifyAIError,
  type AIErrorCategory,
} from '@/server/services/agent/errors';
import type {
  AIFinishReason,
  AIMessage,
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
  AIToolCall,
  AIToolDefinition,
  AIToolResult,
} from '../ai-provider.interface';

/**
 * Maps a standard JSON schema to Gemini's expected Schema format.
 */
function mapJsonSchemaToGeminiSchema(jsonSchema: any): any {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return { type: Type.STRING };
  }

  const result: any = {};

  if (jsonSchema.type) {
    switch (jsonSchema.type.toLowerCase()) {
      case 'object':
        result.type = Type.OBJECT;
        break;
      case 'string':
        result.type = Type.STRING;
        break;
      case 'number':
        result.type = Type.NUMBER;
        break;
      case 'integer':
        result.type = Type.INTEGER;
        break;
      case 'boolean':
        result.type = Type.BOOLEAN;
        break;
      case 'array':
        result.type = Type.ARRAY;
        break;
      default:
        result.type = Type.STRING;
    }
  }

  if (jsonSchema.description) {
    result.description = jsonSchema.description;
  }

  if (jsonSchema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      result.properties[key] = mapJsonSchemaToGeminiSchema(value);
    }
  }

  if (jsonSchema.required) {
    result.required = jsonSchema.required;
  }

  if (jsonSchema.items) {
    result.items = mapJsonSchemaToGeminiSchema(jsonSchema.items);
  }

  if (jsonSchema.enum) {
    result.enum = jsonSchema.enum;
  }

  return result;
}

/**
 * Maps standard AIToolDefinitions to Gemini Tool Declarations.
 */
function mapTools(tools?: AIToolDefinition[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: mapJsonSchemaToGeminiSchema(tool.inputSchema),
  }));

  return [{ functionDeclarations }];
}

/**
 * Categorizes a raw error thrown by @google/genai into the standard taxonomy.
 */
function categorizeGeminiError(error: any): AIErrorCategory {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    
    if (msg.includes('401') || msg.includes('403') || msg.includes('api key')) {
      return 'AUTHORIZATION_FAILURE';
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
      return 'RATE_LIMITED';
    }
    if (msg.includes('timeout') || msg.includes('deadline')) {
      return 'PROVIDER_TIMEOUT';
    }
    if (msg.includes('503') || msg.includes('500') || msg.includes('502') || msg.includes('unavailable')) {
      return 'PROVIDER_UNAVAILABLE';
    }
    if (msg.includes('400') || msg.includes('invalid argument')) {
      return 'MALFORMED_RESPONSE'; // or invalid request, mapped as non-retryable
    }
  }
  return 'TOOL_EXECUTION_FAILURE';
}

/**
 * Normalizes finish reasons.
 */
function mapFinishReason(reason: string | undefined): AIFinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    default:
      // In the new SDK, function call finish reasons aren't always explicit 'tool_calls',
      // but we handle tool call presence directly.
      return 'stop';
  }
}

/**
 * Represents the official Gemini Provider adapter.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey ?? env.AI_API_KEY;
    if (!key) {
      throw new Error('GeminiProvider requires an API key in config (AI_API_KEY)');
    }
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const startTime = Date.now();

    // 1. Separate System Instructions
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemInstruction = systemMessages.map((m) => m.content).join('\n\n');

    // 2. Map standard messages to Gemini contents
    const contents: any[] = [];

    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
    
    for (const msg of nonSystemMessages) {
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: `[USER_MESSAGE]\n${msg.content}\n[/USER_MESSAGE]` }],
        });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const parts = msg.toolCalls.map((tc) => ({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          }));
          contents.push({ role: 'model', parts });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }],
          });
        }
      } else if (msg.role === 'tool' && msg.toolResult) {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolResult.name,
                response: msg.toolResult.result as object,
              },
            },
          ],
        });
      }
    }

    // 3. Map tools
    const mappedTools = mapTools(request.tools);

    // 4. API Request
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: request.model,
        contents,
        config: {
          systemInstruction: systemInstruction ? systemInstruction : undefined,
          tools: mappedTools,
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          stopSequences: request.stopSequences,
        },
      });
    } catch (err) {
      const category = categorizeGeminiError(err);
      const isRetryable = category === 'PROVIDER_TIMEOUT' || category === 'PROVIDER_UNAVAILABLE' || category === 'RATE_LIMITED';
      
      throw new AIAgentError(`Gemini API Error: ${err instanceof Error ? err.message : String(err)}`, {
        category,
        retryability: isRetryable ? 'RETRYABLE' : 'NOT_RETRYABLE',
        cause: err,
      });
    }

    const latencyMs = Date.now() - startTime;
    
    if (!response.candidates || response.candidates.length === 0) {
      throw new AIAgentError('Received empty response from Gemini', {
        category: 'MALFORMED_RESPONSE',
        retryability: 'NOT_RETRYABLE',
      });
    }

    const candidate = response.candidates[0];
    if (!candidate) {
      throw new AIAgentError('Received empty response from Gemini', {
        category: 'MALFORMED_RESPONSE',
        retryability: 'NOT_RETRYABLE',
      });
    }

    const rawFinishReason = candidate.finishReason;

    // Safety checks
    if (
      rawFinishReason === 'SAFETY' ||
      rawFinishReason === 'RECITATION' ||
      rawFinishReason === 'BLOCKLIST'
    ) {
      throw new AIAgentError('Content blocked by safety policy', {
        category: 'SAFETY_POLICY_VIOLATION',
        retryability: 'NOT_RETRYABLE',
      });
    }

    // Extract tool calls
    const parsedToolCalls: AIToolCall[] = [];
    let textContent = '';

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          parsedToolCalls.push({
            id: `call_${Math.random().toString(36).substring(7)}`,
            name: part.functionCall.name ?? 'unknown_tool',
            arguments: part.functionCall.args as Record<string, unknown>,
          });
        }
        if (part.text) {
          textContent += part.text;
        }
      }
    }

    // usage metadata
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    let finishReason = mapFinishReason(rawFinishReason);
    if (parsedToolCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    return {
      message: {
        role: 'assistant',
        content: textContent,
        toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
      },
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
      },
      latencyMs,
      rawResponse: response,
    };
  }
}
