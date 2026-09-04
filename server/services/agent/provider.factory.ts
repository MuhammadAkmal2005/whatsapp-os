/**
 * AI Provider Factory.
 *
 * Resolves the active `AIProvider` from configuration, mirroring
 * `server/services/whatsapp/provider.factory.ts`: a process-wide mock for
 * development and test, the configured real provider otherwise.
 *
 * Callers construct no provider themselves, and that is the point. The AI job
 * handler used to `new MockAIProvider()` unconditionally, so a deployment with
 * `AI_PROVIDER=gemini` would still have answered live customers from the mock —
 * fluent, confident, and entirely made up. Routing every resolution through here
 * means the environment decides, in one place.
 */

import 'server-only';

import { env, isAIMocked } from '@/config/env';
import { NotConfiguredError } from '@/server/errors';
import type { AIProvider } from '@/services/ai/ai-provider.interface';
import { MockAIProvider } from '@/services/ai/mock-ai-provider';
import { GeminiProvider } from '@/services/ai/providers/gemini-provider';

let currentMockProvider: MockAIProvider | null = null;

/**
 * The process-wide mock instance.
 *
 * A singleton rather than a fresh object per call so a test can queue behaviours
 * on the same provider the code under test will be handed.
 */
export function getMockAIProvider(): MockAIProvider {
  if (!currentMockProvider) {
    currentMockProvider = new MockAIProvider();
  }
  return currentMockProvider;
}

export type GetAIProviderOptions = {
  /** Test seam: resolve the configured real provider even when AI_PROVIDER=mock. */
  forceReal?: boolean;
};

/**
 * The provider the current configuration says to use.
 *
 * Synchronous by design — unlike the WhatsApp factory, no credential lives in the
 * database per workspace, so there is nothing to await.
 */
export function getAIProvider(options?: GetAIProviderOptions): AIProvider {
  if (isAIMocked && !options?.forceReal) {
    return getMockAIProvider();
  }

  switch (env.AI_PROVIDER) {
    case 'gemini':
      // `config/env.ts` already refuses to boot with `AI_PROVIDER=gemini` and no
      // `AI_API_KEY`, so the constructor's own check is a second belt rather than
      // the only one.
      return new GeminiProvider();

    case 'mock':
      // Reachable only through `forceReal`, which exists for tests.
      return getMockAIProvider();

    case 'openai':
      // The config enum accepts `openai` because the model names and the price
      // table are shared with it, but no adapter has been written. Refusing is the
      // honest failure here; the alternative is inventing an endpoint shape, and a
      // plausible-looking API that does not exist is worse than a clear gap.
      throw new NotConfiguredError(
        'AI provider',
        'AI_PROVIDER=openai is set but no OpenAI adapter is implemented. Use AI_PROVIDER=gemini, or AI_PROVIDER=mock for offline work.',
      );

    default: {
      // Exhaustive: adding a provider to the env enum without wiring an adapter
      // here becomes a compile error, rather than silently falling back to the
      // mock in production.
      const unhandled: never = env.AI_PROVIDER;
      throw new NotConfiguredError(
        'AI provider',
        `Unsupported AI_PROVIDER: ${String(unhandled)}`,
      );
    }
  }
}

/** Test utility: clears queued behaviours and call history on the mock singleton. */
export function resetMockAIProvider(): void {
  if (currentMockProvider) {
    currentMockProvider.clear();
  }
}
