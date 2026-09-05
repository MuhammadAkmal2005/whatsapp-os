import { describe, expect, it } from 'vitest';

import {
  EMBEDDING_MODELS,
  MODELS,
  estimateCostMicros,
  estimateEmbeddingCostMicros,
  findEmbeddingModelSpec,
  findModelSpec,
  getEmbeddingDimensions,
  getEmbeddingModelSpec,
  getModelSpec,
  modelForTask,
} from '@/config/models';
import { NotConfiguredError } from '@/server/errors';

/**
 * The registry is the only written record of a token price or a vector width. A
 * wrong price misreports what a workspace is spending; a wrong width stores a
 * vector that can never be retrieved. Both lookup shapes are pinned here — the
 * answers and, just as importantly, the refusals.
 */
describe('Generation model lookup', () => {
  it('resolves the Gemini models this deployment actually runs on', () => {
    const flash = getModelSpec('gemini-2.5-flash');
    expect(flash.provider).toBe('gemini');
    expect(flash.tier).toBe('fast');
    expect(flash.supportsTools).toBe(true);

    const pro = getModelSpec('gemini-2.5-pro');
    expect(pro.provider).toBe('gemini');
    expect(pro.tier).toBe('capable');
    expect(pro.supportsTools).toBe(true);
  });

  it('refuses an unknown model instead of substituting another one', () => {
    // The regression this guards: an earlier version returned the gpt-4o-mini
    // spec for anything unrecognised, so a Gemini turn was billed at OpenAI
    // rates and nothing anywhere said so.
    expect(() => getModelSpec('gemini-9.9-imaginary')).toThrow(NotConfiguredError);
    expect(findModelSpec('gemini-9.9-imaginary')).toBeUndefined();
  });

  it('keys every entry by its own id, so a lookup cannot return a different model', () => {
    for (const [id, spec] of Object.entries(MODELS)) {
      expect(spec.id).toBe(id);
    }
  });
});

describe('Gemini pricing', () => {
  it('prices a gemini-2.5-flash turn at the published rate', () => {
    // Published: $0.30 per 1M input tokens, $2.50 per 1M output. Micros per
    // token equals the per-million-token dollar price, so 1,000 in + 1,000 out
    // is 300 + 2,500 = 2,800 micros.
    expect(estimateCostMicros('gemini-2.5-flash', 1000, 1000)).toBe(2800);
  });

  it('prices a gemini-2.5-pro turn at the published rate', () => {
    // $1.25 per 1M input, $10.00 per 1M output at the ≤200k-prompt tier, which
    // is the only tier this product can reach.
    expect(estimateCostMicros('gemini-2.5-pro', 1000, 1000)).toBe(11_250);
  });

  it('rounds a fractional cost up, so spend is never under-reported', () => {
    expect(estimateCostMicros('gemini-2.5-flash', 1, 0)).toBe(1);
  });

  it('reports an unknown cost rather than failing a reply or inventing a price', () => {
    expect(estimateCostMicros('gemini-9.9-imaginary', 1000, 1000)).toBeNull();
  });

  it('charges nothing for the offline mock driver', () => {
    expect(estimateCostMicros('mock-model', 5000, 5000)).toBe(0);
  });
});

describe('Embedding model lookup and dimensions', () => {
  it('resolves the production embedding model to the stored vector width', () => {
    const spec = getEmbeddingModelSpec('gemini-embedding-001');
    expect(spec.provider).toBe('gemini');
    // 1536 is the width requested through outputDimensionality and the width the
    // knowledge_chunks.embedding column was created with. If these ever disagree
    // the corpus is unqueryable, so it is asserted rather than assumed.
    expect(spec.dimensions).toBe(1536);
    expect(getEmbeddingDimensions('gemini-embedding-001')).toBe(1536);
  });

  it('prices embeddings on input tokens only', () => {
    // $0.15 per 1M input tokens; embeddings have no output tokens.
    expect(estimateEmbeddingCostMicros('gemini-embedding-001', 100_000)).toBe(15_000);
    expect(estimateEmbeddingCostMicros('gemini-embedding-001', 0)).toBe(0);
  });

  it('still prices the OpenAI models recorded in usage history', () => {
    // No adapter calls them, but a report over a past month must be able to
    // price a UsageRecord written before the provider decision.
    expect(estimateEmbeddingCostMicros('text-embedding-3-small', 100_000)).toBe(2000);
    expect(findEmbeddingModelSpec('text-embedding-3-large')?.dimensions).toBe(3072);
  });

  it('refuses a dimension lookup for an unconfigured embedding model', () => {
    // 'test-embed-v1' is a value a KnowledgeBase row can hold from an older
    // fixture. Guessing a width for it is how a vector of the wrong length gets
    // written, so the lookup that feeds persistence throws.
    expect(() => getEmbeddingModelSpec('test-embed-v1')).toThrow(NotConfiguredError);
    expect(() => getEmbeddingDimensions('test-embed-v1')).toThrow(NotConfiguredError);
    expect(findEmbeddingModelSpec('test-embed-v1')).toBeUndefined();
    expect(estimateEmbeddingCostMicros('test-embed-v1', 100_000)).toBeNull();
  });

  it('keys every embedding entry by its own id', () => {
    for (const [id, spec] of Object.entries(EMBEDDING_MODELS)) {
      expect(spec.id).toBe(id);
      expect(spec.dimensions).toBeGreaterThan(0);
      expect(spec.microsPerToken).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Provider attribution and task routing', () => {
  it('describes every entry with a provider the codebase can name', () => {
    const known = new Set(['openai', 'gemini', 'mock']);
    for (const spec of Object.values(MODELS)) expect(known.has(spec.provider)).toBe(true);
    for (const spec of Object.values(EMBEDDING_MODELS)) expect(known.has(spec.provider)).toBe(true);
  });

  it('never attributes a Gemini model to OpenAI pricing', () => {
    // Cross-check on the specific confusion that cost the platform its accuracy:
    // the Gemini entries must be dearer per output token than gpt-4o-mini, which
    // is what a silent fallback made them look like.
    const flash = getModelSpec('gemini-2.5-flash');
    const mini = getModelSpec('gpt-4o-mini');
    expect(flash.provider).not.toBe(mini.provider);
    expect(flash.outputMicrosPerToken).not.toBe(mini.outputMicrosPerToken);
  });

  it('sends customer-facing generation to the primary model and cheap work to the fast one', () => {
    const configured = { primary: 'gemini-2.5-pro', fast: 'gemini-2.5-flash' };

    expect(modelForTask('conversation', configured)).toBe('gemini-2.5-pro');
    expect(modelForTask('playground', configured)).toBe('gemini-2.5-pro');
    expect(modelForTask('intent_classification', configured)).toBe('gemini-2.5-flash');
    expect(modelForTask('summarisation', configured)).toBe('gemini-2.5-flash');
    expect(modelForTask('lead_qualification', configured)).toBe('gemini-2.5-flash');
  });
});
