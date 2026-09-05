/**
 * Model catalogue and pricing.
 *
 * Prices live here and nowhere else, so cost reporting cannot drift from what
 * the provider actually charges. They are expressed in **micros per token**
 * (millionths of a currency unit) because per-token costs are far below one
 * minor unit and would round to zero in paisa or cents.
 *
 * Rates are USD-denominated, matching how providers publish them. Conversion to
 * the workspace currency happens at display time only, so a change in exchange
 * rate never rewrites recorded history.
 *
 * Two lookup shapes, and the difference is deliberate. `find*` returns
 * `undefined` for a model this build does not price, because a missing price
 * must never break a customer reply — the metering layer records the tokens and
 * says plainly that the cost is unknown. `get*` throws `NotConfiguredError`, and
 * is for the callers where a wrong answer corrupts data rather than a report:
 * embedding width is the case that matters, since a vector of the wrong length
 * is either rejected by the column or, worse, stored and never retrievable.
 *
 * Neither shape substitutes another model's price. An earlier version returned
 * `gpt-4o-mini` for anything unrecognised, so a Gemini turn was billed at OpenAI
 * rates and nothing anywhere said so.
 */

import { NotConfiguredError } from '@/server/errors';

export type ModelTier = 'fast' | 'balanced' | 'capable';

/**
 * Providers the catalogue can describe, which is wider than what is wired.
 * Adapters exist for `gemini` and `mock`; `openai` is priced because the
 * catalogue predates the provider decision, and `provider.factory.ts` refuses it
 * outright rather than pretending an adapter exists.
 */
export type ModelProvider = 'openai' | 'gemini' | 'mock';

export type ModelSpec = {
  id: string;
  provider: ModelProvider;
  tier: ModelTier;
  /** Micros of USD per input token. */
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
};

export type EmbeddingModelSpec = {
  id: string;
  provider: ModelProvider;
  /**
   * The vector width this deployment produces and stores, and the single source
   * of truth for it: the provider adapter requests this width, the retrieval
   * repository validates query vectors against it, and the `vector(1536)` column
   * was created to match.
   *
   * It is the *requested* width, not necessarily the model's native one — see
   * `gemini-embedding-001`, whose native width is 3072.
   */
  dimensions: number;
  microsPerToken: number;
};

/**
 * Published USD prices are per million tokens; dividing by 1e6 gives dollars
 * per token, and multiplying by 1e6 gives micros per token — so micros per
 * token equals the per-million-token dollar price. The identity is convenient
 * but not obvious, hence this note.
 */
export const MODELS: Record<string, ModelSpec> = {
  /**
   * The generation model this deployment actually runs on. Priced at Google's
   * standard paid-tier rate for text input; audio input is dearer, and this
   * product sends no audio to the model.
   */
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    tier: 'fast',
    inputMicrosPerToken: 0.3,
    outputMicrosPerToken: 2.5,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
  },
  /**
   * Priced at the ≤200k-prompt tier. Prompts above 200k tokens cost twice as
   * much, which this product cannot reach: the context window sent to the model
   * is a rolling summary plus `AI_CONTEXT_MESSAGE_WINDOW` messages.
   */
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    tier: 'capable',
    inputMicrosPerToken: 1.25,
    outputMicrosPerToken: 10,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    tier: 'fast',
    inputMicrosPerToken: 0.15,
    outputMicrosPerToken: 0.6,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    tier: 'capable',
    inputMicrosPerToken: 2.5,
    outputMicrosPerToken: 10,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    tier: 'balanced',
    inputMicrosPerToken: 0.4,
    outputMicrosPerToken: 1.6,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
  },
  /** Deterministic offline driver. Free, and the default in dev and tests. */
  'mock-model': {
    id: 'mock-model',
    provider: 'mock',
    tier: 'fast',
    inputMicrosPerToken: 0,
    outputMicrosPerToken: 0,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
  },
};

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  /**
   * The production embedding model. Its native width is 3072, but this
   * deployment requests 1536 through `outputDimensionality` and stores that:
   * 1536 is under pgvector's 2,000-dimension ceiling for an indexed `vector`
   * column, so an HNSW index is possible at all, and it halves the storage and
   * distance-computation cost for a quality difference that is small at this
   * corpus size.
   *
   * Truncating a Matryoshka embedding leaves it off the unit sphere, so the
   * adapter re-normalises before storage. Price is per input token; embeddings
   * have no output tokens.
   */
  'gemini-embedding-001': {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    dimensions: 1536,
    microsPerToken: 0.15,
  },
  /**
   * Retained because recorded history references them: a `UsageRecord` written
   * before the provider decision names an OpenAI embedding model, and a report
   * over last month's spend must still be able to price it. No adapter calls
   * them.
   */
  'text-embedding-3-small': {
    id: 'text-embedding-3-small',
    provider: 'openai',
    dimensions: 1536,
    microsPerToken: 0.02,
  },
  'text-embedding-3-large': {
    id: 'text-embedding-3-large',
    provider: 'openai',
    dimensions: 3072,
    microsPerToken: 0.13,
  },
  'mock-embedding': {
    id: 'mock-embedding',
    provider: 'mock',
    dimensions: 1536,
    microsPerToken: 0,
  },
};

/** The spec, or `undefined` when this build does not know the model. */
export function findModelSpec(id: string): ModelSpec | undefined {
  return MODELS[id];
}

/**
 * The spec, or a refusal. For callers that cannot proceed on a guess — never for
 * cost reporting, which must not be able to fail a reply.
 */
export function getModelSpec(id: string): ModelSpec {
  const spec = MODELS[id];
  if (!spec) {
    throw new NotConfiguredError(
      'AI model',
      `No model named "${id}" is configured. Add it to config/models.ts with its real published price before using it.`,
    );
  }
  return spec;
}

export function findEmbeddingModelSpec(id: string): EmbeddingModelSpec | undefined {
  return EMBEDDING_MODELS[id];
}

export function getEmbeddingModelSpec(id: string): EmbeddingModelSpec {
  const spec = EMBEDDING_MODELS[id];
  if (!spec) {
    throw new NotConfiguredError(
      'Embedding model',
      `No embedding model named "${id}" is configured. Add it to config/models.ts with its real dimensions and price before using it.`,
    );
  }
  return spec;
}

/**
 * The stored vector width for an embedding model.
 *
 * Throws rather than guessing, and every caller that writes or queries a vector
 * goes through here. A silent default is how a 768-wide vector ends up in a
 * 1536-wide column, or how a query vector of the wrong width is compared against
 * stored ones and returns confident nonsense.
 */
export function getEmbeddingDimensions(id: string): number {
  return getEmbeddingModelSpec(id).dimensions;
}

/**
 * Cost of one completion in micros, rounded up so the platform never
 * under-reports what it is spending. `null` means this build has no price for the
 * model — the caller records the tokens and says the cost is unknown, rather
 * than inventing a figure or failing the turn.
 */
export function estimateCostMicros(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const spec = findModelSpec(modelId);
  if (!spec) return null;

  return Math.ceil(
    inputTokens * spec.inputMicrosPerToken + outputTokens * spec.outputMicrosPerToken,
  );
}

/** As `estimateCostMicros`, for embeddings, which are billed on input only. */
export function estimateEmbeddingCostMicros(modelId: string, tokens: number): number | null {
  const spec = findEmbeddingModelSpec(modelId);
  if (!spec) return null;

  return Math.ceil(tokens * spec.microsPerToken);
}

/**
 * Which model handles which job. Customer-facing generation gets the good
 * model; classification and summarisation, where the output is a label or a
 * paragraph nobody reads closely, get the cheap one. This routing is most of
 * the difference between a viable margin and an unviable one.
 */
export type ModelTask =
  | 'conversation'
  | 'playground'
  | 'intent_classification'
  | 'summarisation'
  | 'lead_qualification';

export function modelForTask(
  task: ModelTask,
  configured: { primary: string; fast: string },
): string {
  switch (task) {
    case 'conversation':
    case 'playground':
      return configured.primary;
    case 'intent_classification':
    case 'summarisation':
    case 'lead_qualification':
      return configured.fast;
  }
}
