/**
 * Deterministic offline embedding provider.
 *
 * Runs the whole retrieval path — ingest, store, query, rank — with no API key
 * and no network, which is what makes the product runnable in development and
 * what makes the integration suite meaningful rather than mocked at the seam
 * above retrieval.
 *
 * It is not noise. Text is projected with the hashing trick: every word lands in
 * a fixed coordinate with a fixed sign, so two texts that share words point in
 * similar directions and two that share nothing are close to orthogonal. Cosine
 * similarity over these vectors therefore behaves like the real thing — a query
 * about refunds ranks the refund paragraph first — while remaining exactly
 * reproducible. A random vector per call would satisfy "returns 1536 numbers"
 * and nothing else: no test could assert a ranking, and the same document
 * re-embedded would move.
 */

import { APPROX_CHARS_PER_TOKEN } from '@/config/constants';
import { getEmbeddingDimensions } from '@/config/models';

import type {
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingTask,
} from './embedding-provider.interface';

/** The catalogue entry describing this driver: 1536 wide, free. */
const MOCK_EMBEDDING_MODEL = 'mock-embedding';

// FNV-1a, 32-bit. Chosen for being short, dependency-free and stable across
// platforms and Node versions — a hash that changed between runs would make
// stored vectors unreadable by the next process, which is the one property this
// provider exists to guarantee.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashToken(token: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Unicode-aware so Urdu script survives. `text.split(/\W+/)` would reduce
 * "قیمت کیا ہے" to nothing and hand every Urdu message the same vector.
 */
function tokenise(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  // An empty or punctuation-only string still has to produce a unit vector:
  // pgvector will not index a zero vector and cosine distance to one is
  // undefined, so there is no "no direction" to represent.
  return tokens && tokens.length > 0 ? tokens : ['__empty__'];
}

export type MockEmbeddingProviderOptions = {
  /**
   * Overrides the vector width. Only for tests that need to prove the
   * dimension guards downstream actually reject a mismatched vector; production
   * and development take the width from the catalogue.
   */
  dimensions?: number;
};

export class MockEmbeddingProvider implements EmbeddingProvider {
  /** Labelled as a mock wherever it appears — logs, usage rows, provenance. */
  readonly name = 'mock';
  readonly model = MOCK_EMBEDDING_MODEL;
  readonly dimensions: number;

  /** What was asked of it, in order. Lets a test assert the task mapping. */
  public callHistory: Array<{ text: string; task: EmbeddingTask }> = [];

  constructor(options: MockEmbeddingProviderOptions = {}) {
    this.dimensions = options.dimensions ?? getEmbeddingDimensions(MOCK_EMBEDDING_MODEL);
  }

  clear(): void {
    this.callHistory = [];
  }

  async embed(text: string, task: EmbeddingTask): Promise<EmbeddingResult> {
    this.callHistory.push({ text, task });

    return {
      embedding: this.vectorFor(text),
      usage: { inputTokens: estimateTokens([text]), estimated: true },
    };
  }

  async embedMany(
    texts: readonly string[],
    task: EmbeddingTask,
  ): Promise<EmbeddingBatchResult> {
    for (const text of texts) this.callHistory.push({ text, task });

    return {
      embeddings: texts.map((text) => this.vectorFor(text)),
      usage: { inputTokens: estimateTokens(texts), estimated: true },
    };
  }

  /**
   * The task deliberately does not enter the geometry.
   *
   * A real asymmetric model is trained so that a query lands near the documents
   * that answer it. A mock that perturbed the two differently would only make
   * document and query vectors *less* comparable, and offline retrieval would
   * return nothing for reasons that teach nobody anything. The task is recorded
   * in `callHistory` instead, which is where a test can assert it was passed.
   */
  private vectorFor(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);

    for (const token of tokenise(text)) {
      const hash = hashToken(token);
      const index = hash % this.dimensions;
      // Signed hashing: collisions cancel rather than always accumulating, which
      // keeps unrelated texts near-orthogonal instead of drifting together.
      const sign = ((hash >>> 16) & 1) === 1 ? -1 : 1;
      vector[index] = (vector[index] ?? 0) + sign;
    }

    return normalise(vector);
  }
}

/**
 * Unit length, so cosine similarity is a plain dot product and the values sit in
 * the same range the real provider returns.
 */
function normalise(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;

  if (sumOfSquares === 0) {
    // Only reachable if every token's contribution cancelled exactly. Any fixed
    // unit vector will do; what matters is that it is never the zero vector.
    const fallback = new Array<number>(vector.length).fill(0);
    fallback[0] = 1;
    return fallback;
  }

  const norm = Math.sqrt(sumOfSquares);
  return vector.map((value) => value / norm);
}

/** Same estimator the real adapter uses, so metering reads alike offline. */
function estimateTokens(texts: readonly string[]): number {
  const characters = texts.reduce((total, text) => total + text.length, 0);
  return Math.ceil(characters / APPROX_CHARS_PER_TOKEN);
}
