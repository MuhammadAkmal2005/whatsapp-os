/**
 * Mock embedding provider and the factory that selects it.
 *
 * The determinism assertions are the point of the file. If the mock's vectors
 * moved between calls, every offline retrieval test in the suite would be
 * asserting against noise and would still report as passing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmbeddingDimensions } from '@/config/models';
import { MockEmbeddingProvider } from '@/services/ai/mock-embedding-provider';

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((total, value, index) => total + value * (b[index] ?? 0), 0);
}

function magnitude(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

describe('MockEmbeddingProvider', () => {
  it('identifies itself as a mock in name, model and width', () => {
    const provider = new MockEmbeddingProvider();

    expect(provider.name).toBe('mock');
    expect(provider.model).toBe('mock-embedding');
    expect(provider.dimensions).toBe(getEmbeddingDimensions('mock-embedding'));
  });

  it('returns the same vector for the same text, across instances', async () => {
    const first = await new MockEmbeddingProvider().embed('return policy is 7 days', 'document');
    const second = await new MockEmbeddingProvider().embed('return policy is 7 days', 'document');

    expect(first.embedding).toEqual(second.embedding);
  });

  it('produces unit vectors, so cosine similarity is a dot product', async () => {
    const { embedding } = await new MockEmbeddingProvider().embed('delivery in Lahore', 'query');

    expect(magnitude(embedding)).toBeCloseTo(1, 10);
  });

  // Not "returns 1536 numbers" — the retrieval suite depends on shared words
  // actually ranking above unrelated text.
  it('ranks shared vocabulary above unrelated text', async () => {
    const provider = new MockEmbeddingProvider();

    const query = await provider.embed('what is your return policy', 'query');
    const related = await provider.embed('our return policy allows returns for 7 days', 'document');
    const unrelated = await provider.embed('shipping charges for Karachi orders', 'document');

    expect(dot(query.embedding, related.embedding)).toBeGreaterThan(
      dot(query.embedding, unrelated.embedding),
    );
  });

  it('embeds Urdu script rather than collapsing it to one vector', async () => {
    const provider = new MockEmbeddingProvider();

    const price = await provider.embed('قیمت کیا ہے', 'query');
    const delivery = await provider.embed('ڈیلیوری کتنے دن', 'query');

    expect(price.embedding).not.toEqual(delivery.embedding);
    expect(magnitude(price.embedding)).toBeCloseTo(1, 10);
  });

  it('gives an empty string a usable unit vector rather than zeros', async () => {
    const { embedding } = await new MockEmbeddingProvider().embed('   ', 'document');

    expect(magnitude(embedding)).toBeCloseTo(1, 10);
    expect(embedding.some((value) => value !== 0)).toBe(true);
  });

  it('batches positionally and matches single embedding for the same text', async () => {
    const provider = new MockEmbeddingProvider();
    const texts = ['first chunk', 'second chunk', 'third chunk'];

    const batch = await provider.embedMany(texts, 'document');
    const single = await provider.embed('second chunk', 'document');

    expect(batch.embeddings).toHaveLength(3);
    expect(batch.embeddings[1]).toEqual(single.embedding);
  });

  it('records the task it was asked for without changing the geometry', async () => {
    const provider = new MockEmbeddingProvider();

    const asDocument = await provider.embed('same text', 'document');
    const asQuery = await provider.embed('same text', 'query');

    expect(provider.callHistory).toEqual([
      { text: 'same text', task: 'document' },
      { text: 'same text', task: 'query' },
    ]);
    expect(asDocument.embedding).toEqual(asQuery.embedding);
  });

  it('estimates tokens locally and says so', async () => {
    const provider = new MockEmbeddingProvider();

    const result = await provider.embedMany(['1234', '12345678'], 'document');

    expect(result.usage).toEqual({ inputTokens: 3, estimated: true });
  });

  it('honours a width override so downstream dimension guards can be tested', async () => {
    const provider = new MockEmbeddingProvider({ dimensions: 8 });

    const { embedding } = await provider.embed('narrow', 'document');

    expect(provider.dimensions).toBe(8);
    expect(embedding).toHaveLength(8);
  });

  it('clears its call history', async () => {
    const provider = new MockEmbeddingProvider();
    await provider.embed('text', 'query');

    provider.clear();

    expect(provider.callHistory).toEqual([]);
  });
});

/**
 * Each factory case re-imports the module under a patched `config/env`, because
 * `env` is parsed once at import time and `isAIMocked` is a module constant. A
 * `beforeEach` that mutated `process.env` would not change either.
 */
async function loadFactory(overrides: { AI_PROVIDER: string; MOCK_AI?: boolean }) {
  vi.resetModules();

  const actual = await vi.importActual<typeof import('@/config/env')>('@/config/env');

  vi.doMock('@/config/env', () => ({
    ...actual,
    env: { ...actual.env, AI_PROVIDER: overrides.AI_PROVIDER },
    isAIMocked: overrides.MOCK_AI ?? overrides.AI_PROVIDER === 'mock',
  }));

  return import('@/server/services/agent/embedding-provider.factory');
}

/**
 * `NotConfiguredError` from the *same* module graph as the factory under test.
 * `vi.resetModules()` gives the dynamic import a fresh copy of every module, so a
 * statically imported class is a different identity and `instanceof` is false for
 * an error that is otherwise exactly right.
 */
async function loadNotConfiguredError() {
  const errors = await import('@/server/errors');
  return errors.NotConfiguredError;
}

describe('getEmbeddingProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/config/env');
    vi.resetModules();
  });

  it('returns the mock when AI is mocked', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'mock' });

    expect(factory.getEmbeddingProvider().name).toBe('mock');
  });

  // A mocked deployment must not reach a real provider by accident, whatever
  // AI_PROVIDER happens to say.
  it('returns the mock when AI is mocked even if a real provider is configured', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'gemini', MOCK_AI: true });

    expect(factory.getEmbeddingProvider().name).toBe('mock');
  });

  it('returns the Gemini adapter when forced past the mock', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'gemini', MOCK_AI: true });

    const provider = factory.getEmbeddingProvider({ forceReal: true });

    expect(provider.name).toBe('gemini');
    expect(provider.model).toBe('gemini-embedding-001');
    expect(provider.dimensions).toBe(1536);
  });

  it('returns the Gemini adapter when Gemini is configured and not mocked', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'gemini', MOCK_AI: false });

    expect(factory.getEmbeddingProvider().name).toBe('gemini');
  });

  it('still returns the mock when AI_PROVIDER=mock is forced', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'mock' });

    expect(factory.getEmbeddingProvider({ forceReal: true }).name).toBe('mock');
  });

  // Refusing is the honest answer: the stored corpus is Gemini's, so embedding a
  // query with anything else would make every distance meaningless.
  it('refuses OpenAI rather than pretending an adapter exists', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'openai', MOCK_AI: false });
    const NotConfiguredError = await loadNotConfiguredError();

    expect(() => factory.getEmbeddingProvider()).toThrow(NotConfiguredError);
    expect(() => factory.getEmbeddingProvider()).toThrow(/no OpenAI embedding adapter/);
  });

  it('refuses an unrecognised provider instead of falling back to the mock', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'anthropic-someday', MOCK_AI: false });
    const NotConfiguredError = await loadNotConfiguredError();

    expect(() => factory.getEmbeddingProvider()).toThrow(NotConfiguredError);
  });

  it('hands out one mock instance so a test can read what the code was given', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'mock' });

    const first = factory.getEmbeddingProvider();
    const second = factory.getMockEmbeddingProvider();

    expect(first).toBe(second);
  });

  it('resetMockEmbeddingProvider clears the singleton history', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'mock' });

    await factory.getMockEmbeddingProvider().embed('text', 'query');
    factory.resetMockEmbeddingProvider();

    expect(factory.getMockEmbeddingProvider().callHistory).toEqual([]);
  });

  it('resetMockEmbeddingProvider is safe before a provider has been resolved', async () => {
    const factory = await loadFactory({ AI_PROVIDER: 'mock' });

    expect(() => factory.resetMockEmbeddingProvider()).not.toThrow();
  });
});
