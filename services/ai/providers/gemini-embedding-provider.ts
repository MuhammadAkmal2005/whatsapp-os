import 'server-only';

import { GoogleGenAI } from '@google/genai';
import { env } from '@/config/env';
import { AIAgentError } from '@/server/services/agent/errors';
import type { EmbeddingProvider, EmbeddingResult } from '../embedding-provider.interface';

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey ?? env.AI_API_KEY;
    if (!key) {
      throw new Error('GeminiEmbeddingProvider requires an API key in config (AI_API_KEY)');
    }
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  async embed(text: string, model: string): Promise<EmbeddingResult> {
    try {
      const response = await this.ai.models.embedContent({
        model,
        contents: text,
      });

      if (!response.embeddings || response.embeddings.length === 0 || !response.embeddings[0]?.values) {
        throw new AIAgentError('Empty embedding response', {
          category: 'MALFORMED_RESPONSE',
          retryability: 'NOT_RETRYABLE',
        });
      }

      return {
        embedding: response.embeddings[0]!.values,
        usage: {
          // Gemini SDK doesn't always provide explicit input token counts for embeddings,
          // but if it's not present, we default to 0 for telemetry. 
          // (Usually handled transparently or billed per char)
          inputTokens: 0, 
        },
      };
    } catch (err: any) {
      const isRetryable = err?.status === 429 || err?.status >= 500;
      throw new AIAgentError(`Gemini Embedding Error: ${err instanceof Error ? err.message : String(err)}`, {
        category: 'PROVIDER_UNAVAILABLE',
        retryability: isRetryable ? 'RETRYABLE' : 'NOT_RETRYABLE',
        cause: err,
      });
    }
  }
}
