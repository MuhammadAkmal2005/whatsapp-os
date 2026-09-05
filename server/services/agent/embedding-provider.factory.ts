/**
 * Embedding Provider Factory.
 *
 * The mirror of `provider.factory.ts` for vectors, and it exists for the same
 * reason: the environment decides which adapter answers, in one place. A caller
 * that constructs its own provider is a caller that can quietly embed a query
 * with a different model than the corpus was built with, and a corpus embedded by
 * two models is a corpus whose distances mean nothing.
 *
 * The model itself is never a parameter here. It comes from `AI_EMBEDDING_MODEL`
 * via the adapter, so every vector this process produces — document or query,
 * ingest or reply — is produced by the same model.
 */

import 'server-only';

import { env, isAIMocked } from '@/config/env';
import { NotConfiguredError } from '@/server/errors';
import type { EmbeddingProvider } from '@/services/ai/embedding-provider.interface';
import { MockEmbeddingProvider } from '@/services/ai/mock-embedding-provider';
import { GeminiEmbeddingProvider } from '@/services/ai/providers/gemini-embedding-provider';

let currentMockProvider: MockEmbeddingProvider | null = null;

/**
 * The process-wide mock instance.
 *
 * A singleton so a test can read the call history of the very provider the code
 * under test was handed, and so repeated resolution in one request does not
 * rebuild it.
 */
export function getMockEmbeddingProvider(): MockEmbeddingProvider {
  if (!currentMockProvider) {
    currentMockProvider = new MockEmbeddingProvider();
  }
  return currentMockProvider;
}

export type GetEmbeddingProviderOptions = {
  /** Test seam: resolve the configured real adapter even when AI_PROVIDER=mock. */
  forceReal?: boolean;
};

/**
 * The embedding provider the current configuration says to use.
 *
 * Synchronous, like `getAIProvider`, because no embedding credential is stored
 * per workspace — the key is process configuration, so there is nothing to await.
 *
 * Note that the mock is selected by `AI_PROVIDER`, not by a separate embedding
 * switch. One provider decision covers generation and embeddings, so a deployment
 * cannot end up answering from a mock while embedding for real, or the reverse.
 */
export function getEmbeddingProvider(options?: GetEmbeddingProviderOptions): EmbeddingProvider {
  if (isAIMocked && !options?.forceReal) {
    return getMockEmbeddingProvider();
  }

  switch (env.AI_PROVIDER) {
    case 'gemini':
      return new GeminiEmbeddingProvider();

    case 'mock':
      // Reachable only through `forceReal`, which exists for tests.
      return getMockEmbeddingProvider();

    case 'openai':
      // OpenAI embedding models are priced in the catalogue because recorded
      // usage history references them, but no adapter calls them and this
      // deployment's stored vectors are Gemini's. Refusing is honest; silently
      // embedding with a different model would make every stored distance wrong.
      throw new NotConfiguredError(
        'Embedding provider',
        'AI_PROVIDER=openai is set but no OpenAI embedding adapter is implemented. Use AI_PROVIDER=gemini, or AI_PROVIDER=mock for offline work.',
      );

    default: {
      // Exhaustive: adding a provider to the env enum without wiring an adapter
      // here is a compile error rather than a silent fallback to the mock, which
      // in production means a corpus of vectors nobody can query.
      const unhandled: never = env.AI_PROVIDER;
      throw new NotConfiguredError(
        'Embedding provider',
        `Unsupported AI_PROVIDER: ${String(unhandled)}`,
      );
    }
  }
}

/** Test utility: clears the call history on the mock singleton. */
export function resetMockEmbeddingProvider(): void {
  if (currentMockProvider) {
    currentMockProvider.clear();
  }
}
