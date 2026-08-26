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
 */

export type ModelTier = 'fast' | 'balanced' | 'capable';

export type ModelSpec = {
  id: string;
  provider: 'openai' | 'mock';
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
  provider: 'openai' | 'mock';
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

/** Falls back to the cheapest known model rather than throwing, because an
 *  unknown model id should degrade the cost estimate, not break a reply. */
export function getModelSpec(id: string): ModelSpec {
  return MODELS[id] ?? MODELS['gpt-4o-mini']!;
}

export function getEmbeddingModelSpec(id: string): EmbeddingModelSpec {
  return EMBEDDING_MODELS[id] ?? EMBEDDING_MODELS['text-embedding-3-small']!;
}

/**
 * Cost of one completion in micros, rounded up. Rounding up means the platform
 * never under-reports what it is spending.
 */
export function estimateCostMicros(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const spec = getModelSpec(modelId);
  return Math.ceil(
    inputTokens * spec.inputMicrosPerToken + outputTokens * spec.outputMicrosPerToken,
  );
}

export function estimateEmbeddingCostMicros(modelId: string, tokens: number): number {
  return Math.ceil(tokens * getEmbeddingModelSpec(modelId).microsPerToken);
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
