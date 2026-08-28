/**
 * Provider-neutral AI interface and normalized DTOs.
 *
 * Defines the contract between the Agent Runtime and model providers
 * (e.g. Mock, Gemini, OpenAI, Anthropic, local models).
 *
 * Domain services MUST NOT depend on vendor-specific SDK types.
 */

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export interface AIMessage {
  role: AIMessageRole;
  content: string;
  toolCalls?: AIToolCall[];
  toolResult?: AIToolResult;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface AIProviderRequest {
  model: string;
  messages: AIMessage[];
  tools?: AIToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AIFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'error';

export interface AIProviderResponse {
  message: AIMessage;
  finishReason: AIFinishReason;
  usage: AIUsage;
  latencyMs: number;
  rawResponse?: unknown;
}

export interface AIProvider {
  readonly name: string;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}
