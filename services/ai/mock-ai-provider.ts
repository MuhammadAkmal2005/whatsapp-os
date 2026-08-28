/**
 * Deterministic Mock AI Provider for testing and local simulation.
 *
 * Allows programmatic queuing of responses, tool-call sequences, and error behaviors
 * without network calls.
 */

import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
} from './ai-provider.interface';

export type MockAIBehavior =
  | { type: 'response'; response: Partial<AIProviderResponse> }
  | { type: 'error'; error: Error }
  | { type: 'echo'; prefix?: string };

export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  private behaviors: MockAIBehavior[] = [];
  public callHistory: AIProviderRequest[] = [];

  constructor(initialBehaviors: MockAIBehavior[] = []) {
    this.behaviors = [...initialBehaviors];
  }

  enqueue(behavior: MockAIBehavior): this {
    this.behaviors.push(behavior);
    return this;
  }

  clear(): void {
    this.behaviors = [];
    this.callHistory = [];
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    this.callHistory.push(request);

    const behavior = this.behaviors.shift();

    if (!behavior) {
      // Default behavior: Echo the last user message or return simple acknowledgement
      const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
      const content = lastUserMsg ? `Mock reply: ${lastUserMsg.content}` : 'Mock default response';

      return {
        message: {
          role: 'assistant',
          content,
        },
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 15,
        },
        latencyMs: 5,
      };
    }

    if (behavior.type === 'error') {
      throw behavior.error;
    }

    if (behavior.type === 'echo') {
      const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
      const prefix = behavior.prefix ?? 'Echo: ';
      return {
        message: {
          role: 'assistant',
          content: `${prefix}${lastUserMsg?.content ?? ''}`,
        },
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
        },
        latencyMs: 5,
      };
    }

    // behavior.type === 'response'
    const res = behavior.response;
    return {
      message: res.message ?? {
        role: 'assistant',
        content: 'Mock scripted response',
      },
      finishReason: res.finishReason ?? 'stop',
      usage: res.usage ?? {
        inputTokens: 20,
        outputTokens: 20,
      },
      latencyMs: res.latencyMs ?? 5,
      rawResponse: res.rawResponse,
    };
  }
}
