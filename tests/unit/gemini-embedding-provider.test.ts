/**
 * Gemini embedding adapter.
 *
 * Every test here goes through the `embedContent` seam rather than the SDK, so
 * what is under test is the adapter's own behaviour: the two task strings, the
 * requested width, the re-normalisation truncation requires, and the validation
 * that stands between a malformed provider response and a vector column.
 */

import { describe, expect, it, vi } from 'vitest';

import { getEmbeddingDimensions } from '@/config/models';
import { AIAgentError } from '@/server/services/agent/errors';
import {
  GeminiEmbeddingProvider,
  type GeminiEmbedContent,
} from '@/services/ai/providers/gemini-embedding-provider';

const DIMENSIONS = getEmbeddingDimensions('gemini-embedding-001');

/** An unnormalised vector of the configured width, so normalisation is observable. */
function rawVector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, index) => seed + (index % 7) + 1);
}

function respondWith(...vectors: number[][]): GeminiEmbedContent {
  return vi.fn(async () => ({ embeddings: vectors.map((values) => ({ values })) }));
}

function magnitude(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

describe('GeminiEmbeddingProvider', () => {
  it('reports the configured model and its catalogued width', () => {
    const provider = new GeminiEmbeddingProvider({ embedContent: respondWith(rawVector(1)) });

    expect(provider.name).toBe('gemini');
    expect(provider.model).toBe('gemini-embedding-001');
    expect(provider.dimensions).toBe(DIMENSIONS);
  });

  it('embeds a document with RETRIEVAL_DOCUMENT', async () => {
    const embedContent = respondWith(rawVector(1));
    const provider = new GeminiEmbeddingProvider({ embedContent });

    await provider.embed('Kurta, black, XL, Rs. 3,499', 'document');

    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: ['Kurta, black, XL, Rs. 3,499'],
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMENSIONS },
    });
  });

  it('embeds a query with RETRIEVAL_QUERY', async () => {
    const embedContent = respondWith(rawVector(1));
    const provider = new GeminiEmbeddingProvider({ embedContent });

    await provider.embed('black kurta XL available hai?', 'query');

    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: ['black kurta XL available hai?'],
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: DIMENSIONS },
    });
  });

  it('requests the stored column width as outputDimensionality', async () => {
    const embedContent = respondWith(rawVector(1));
    const provider = new GeminiEmbeddingProvider({ embedContent });

    await provider.embed('anything', 'document');

    const request = vi.mocked(embedContent).mock.calls[0]?.[0];
    expect(request?.config.outputDimensionality).toBe(1536);
  });

  // Truncating a Matryoshka vector shortens it; without this the stored vectors
  // are not unit length and cosine distance stops matching the model's training.
  it('re-normalises the truncated vector to unit length', async () => {
    const raw = rawVector(3);
    const provider = new GeminiEmbeddingProvider({ embedContent: respondWith(raw) });

    const result = await provider.embed('policy text', 'document');

    expect(magnitude(raw)).toBeGreaterThan(1.5);
    expect(magnitude(result.embedding)).toBeCloseTo(1, 10);
    // Direction preserved: every coordinate scaled by the same factor.
    const factor = magnitude(raw);
    expect(result.embedding[0]).toBeCloseTo((raw[0] as number) / factor, 10);
  });

  it('rejects a malformed provider response rather than persisting it', async () => {
    const cases: unknown[] = [
      {},
      { embeddings: 'not-an-array' },
      { embeddings: [{}] },
      { embeddings: [{ values: 'nope' }] },
      { embeddings: [{ values: [Number.NaN, ...rawVector(1).slice(1)] }] },
    ];

    for (const response of cases) {
      const provider = new GeminiEmbeddingProvider({
        embedContent: vi.fn(async () => response),
      });

      await expect(provider.embed('text', 'query')).rejects.toBeInstanceOf(AIAgentError);
    }
  });

  it('rejects a vector of the wrong width before it reaches the database', async () => {
    const provider = new GeminiEmbeddingProvider({
      embedContent: respondWith(new Array<number>(768).fill(0.1)),
    });

    await expect(provider.embed('text', 'query')).rejects.toThrow(/768 dimensions, expected 1536/);
  });

  it('rejects a zero vector, which has no direction to compare against', async () => {
    const provider = new GeminiEmbeddingProvider({
      embedContent: respondWith(new Array<number>(DIMENSIONS).fill(0)),
    });

    await expect(provider.embed('text', 'query')).rejects.toThrow(/zero vector/);
  });

  it('sends one batched request and preserves input order', async () => {
    const first = rawVector(1);
    const second = rawVector(50);
    const third = rawVector(100);
    const embedContent = respondWith(first, second, third);
    const provider = new GeminiEmbeddingProvider({ embedContent });

    const result = await provider.embedMany(['one', 'two', 'three'], 'document');

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedContent).mock.calls[0]?.[0].contents).toEqual(['one', 'two', 'three']);
    expect(result.embeddings).toHaveLength(3);
    // Normalisation is monotonic per vector, so the seeds stay distinguishable.
    expect(result.embeddings[0]?.[0]).toBeCloseTo((first[0] as number) / magnitude(first), 10);
    expect(result.embeddings[1]?.[0]).toBeCloseTo((second[0] as number) / magnitude(second), 10);
    expect(result.embeddings[2]?.[0]).toBeCloseTo((third[0] as number) / magnitude(third), 10);
  });

  it('refuses a batch whose length does not match the inputs', async () => {
    const provider = new GeminiEmbeddingProvider({
      embedContent: respondWith(rawVector(1), rawVector(2)),
    });

    await expect(provider.embedMany(['a', 'b', 'c'], 'document')).rejects.toThrow(
      /2 embeddings for 3 inputs/,
    );
  });

  it('makes no request for an empty batch', async () => {
    const embedContent = respondWith();
    const provider = new GeminiEmbeddingProvider({ embedContent });

    const result = await provider.embedMany([], 'document');

    expect(embedContent).not.toHaveBeenCalled();
    expect(result.embeddings).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 0, estimated: true });
  });

  // The Developer API reports no usable per-input token count for embeddings, so
  // the number is derived locally and must say so all the way to the usage row.
  it('reports token counts as local estimates, never as provider-reported', async () => {
    const provider = new GeminiEmbeddingProvider({ embedContent: respondWith(rawVector(1)) });

    const result = await provider.embed('12345678', 'query');

    expect(result.usage.estimated).toBe(true);
    expect(result.usage.inputTokens).toBe(2); // 8 characters / APPROX_CHARS_PER_TOKEN
  });

  it('estimates batch usage over the whole batch', async () => {
    const provider = new GeminiEmbeddingProvider({
      embedContent: respondWith(rawVector(1), rawVector(2)),
    });

    const result = await provider.embedMany(['1234', '12345678'], 'document');

    expect(result.usage).toEqual({ inputTokens: 3, estimated: true });
  });

  it('classifies a rate limit as retryable and a bad request as not', async () => {
    const rateLimited = new GeminiEmbeddingProvider({
      embedContent: vi.fn(async () => {
        throw Object.assign(new Error('quota exceeded'), { status: 429 });
      }),
    });
    const badRequest = new GeminiEmbeddingProvider({
      embedContent: vi.fn(async () => {
        throw Object.assign(new Error('invalid argument'), { status: 400 });
      }),
    });

    await expect(rateLimited.embed('t', 'query')).rejects.toMatchObject({
      category: 'RATE_LIMITED',
      retryability: 'RETRYABLE',
    });
    await expect(badRequest.embed('t', 'query')).rejects.toMatchObject({
      retryability: 'NOT_RETRYABLE',
    });
  });
});
