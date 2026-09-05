import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { APPROX_CHARS_PER_TOKEN } from '@/config/constants';
import { env } from '@/config/env';
import { getEmbeddingDimensions } from '@/config/models';
import { NotConfiguredError } from '@/server/errors';
import { AIAgentError, classifyAIError } from '@/server/services/agent/errors';

import type {
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingTask,
} from '../embedding-provider.interface';

/**
 * Gemini embeddings, and the only file that knows Gemini's vocabulary.
 *
 * Everything Gemini-shaped stops here: the task-type strings, the
 * `outputDimensionality` request, the response shape, and the re-normalisation
 * that truncating a Matryoshka vector requires. Above this file the stack sees
 * `'document' | 'query'`, a width, and an array of numbers.
 */

/**
 * `gemini-embedding-001` is trained at 3072 and supports Matryoshka truncation
 * to narrower widths. The native vector arrives L2-normalised; a truncated one
 * does not, because dropping trailing coordinates shortens the vector. So this
 * number decides whether we re-normalise, and normalising a future full-width
 * model would be corrupting a vector the provider already normalised.
 */
const GEMINI_EMBEDDING_001 = 'gemini-embedding-001';
const GEMINI_EMBEDDING_001_NATIVE_DIMENSIONS = 3072;

/** The width the `knowledge_chunks.embedding` column was created with. */
const STORED_VECTOR_DIMENSIONS = 1536;

/**
 * Our two words, translated at the boundary. Asymmetric retrieval is the whole
 * point: a query embedded as a document is compared against the wrong side of
 * the model's training objective and ranks worse for no visible reason.
 */
const TASK_TYPES: Record<EmbeddingTask, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

/**
 * The one call this adapter makes, as a function rather than an SDK object.
 *
 * A test can substitute it without constructing a `GoogleGenAI`, and the real
 * implementation is a one-line lambda whose argument is type-checked against the
 * installed SDK — so if `@google/genai` changes the shape of `embedContent`,
 * this file fails to compile instead of failing in production. The return is
 * `unknown` on purpose: every field is validated below, and typing it as the
 * SDK's response would let a non-null assertion look reasonable.
 */
export type GeminiEmbedContent = (request: {
  model: string;
  contents: string[];
  config: { taskType: string; outputDimensionality: number };
}) => Promise<unknown>;

export type GeminiEmbeddingProviderOptions = {
  apiKey?: string;
  /** Test seam. Production leaves this unset and the real SDK is constructed. */
  embedContent?: GeminiEmbedContent;
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions: number;

  private readonly embedContent: GeminiEmbedContent;
  private readonly requiresNormalisation: boolean;

  constructor(options: GeminiEmbeddingProviderOptions = {}) {
    // Configuration chooses the model, not the caller and not a database row.
    this.model = env.AI_EMBEDDING_MODEL;
    this.dimensions = getEmbeddingDimensions(this.model);

    // The registry is the single source of truth for the width, and this is the
    // assertion that keeps it honest against the column it has to fit. Editing
    // the catalogue without migrating the column would otherwise produce vectors
    // Postgres rejects at insert time, halfway through an ingest.
    if (this.model === GEMINI_EMBEDDING_001 && this.dimensions !== STORED_VECTOR_DIMENSIONS) {
      throw new NotConfiguredError(
        'Embedding model',
        `${GEMINI_EMBEDDING_001} is configured for ${this.dimensions} dimensions, but stored vectors are ${STORED_VECTOR_DIMENSIONS}-wide. Re-embed the corpus and migrate the column before changing this.`,
      );
    }

    this.requiresNormalisation =
      this.model === GEMINI_EMBEDDING_001 &&
      this.dimensions !== GEMINI_EMBEDDING_001_NATIVE_DIMENSIONS;

    this.embedContent = options.embedContent ?? createSdkEmbedContent(options.apiKey);
  }

  async embed(text: string, task: EmbeddingTask): Promise<EmbeddingResult> {
    const vectors = await this.request([text], task);

    const embedding = vectors[0];
    if (!embedding) {
      throw new AIAgentError('Gemini returned no embedding for the requested text.', {
        category: 'MALFORMED_RESPONSE',
        retryability: 'NOT_RETRYABLE',
      });
    }

    return { embedding, usage: estimateUsage([text]) };
  }

  /**
   * One request carrying many independent contents, which is what the SDK's array
   * form means — not N requests. Ingesting a document is dozens of chunks, and
   * doing them one at a time multiplies latency and rate-limit exposure for
   * identical work.
   */
  async embedMany(
    texts: readonly string[],
    task: EmbeddingTask,
  ): Promise<EmbeddingBatchResult> {
    if (texts.length === 0) {
      return { embeddings: [], usage: { inputTokens: 0, estimated: true } };
    }

    return {
      embeddings: await this.request(texts, task),
      usage: estimateUsage(texts),
    };
  }

  private async request(texts: readonly string[], task: EmbeddingTask): Promise<number[][]> {
    let response: unknown;

    try {
      response = await this.embedContent({
        model: this.model,
        contents: [...texts],
        config: {
          taskType: TASK_TYPES[task],
          outputDimensionality: this.dimensions,
        },
      });
    } catch (error: unknown) {
      throw toAgentError(error);
    }

    // Validation is outside the try so a malformed-response error is not
    // re-wrapped as a transport failure and retried forever.
    const vectors = readEmbeddings(response, texts.length, this.dimensions);

    return this.requiresNormalisation ? vectors.map(normalise) : vectors;
  }
}

function createSdkEmbedContent(apiKey?: string): GeminiEmbedContent {
  const key = apiKey ?? env.AI_API_KEY;

  if (!key) {
    throw new NotConfiguredError(
      'Gemini embeddings',
      'AI_API_KEY is required to embed with Gemini. Use AI_PROVIDER=mock for offline work.',
    );
  }

  const client = new GoogleGenAI({ apiKey: key });

  return (request) => client.models.embedContent(request);
}

function malformed(message: string, cause?: unknown): AIAgentError {
  return new AIAgentError(message, {
    category: 'MALFORMED_RESPONSE',
    retryability: 'NOT_RETRYABLE',
    cause,
  });
}

/**
 * Every field checked, nothing asserted.
 *
 * A vector of the wrong width is the failure worth this much code: Postgres
 * rejects it at insert, or a query vector of the wrong width is compared against
 * stored ones and returns confident nonsense. Both are cheaper to catch here.
 */
function readEmbeddings(
  response: unknown,
  expectedCount: number,
  expectedDimensions: number,
): number[][] {
  if (typeof response !== 'object' || response === null || !('embeddings' in response)) {
    throw malformed('Gemini embedding response contained no embeddings field.');
  }

  if (!Array.isArray(response.embeddings)) {
    throw malformed('Gemini embedding response embeddings field was not an array.');
  }

  const entries: unknown[] = response.embeddings;

  // Positional pairing is the only correlation available between inputs and
  // vectors, so a short or long batch is unusable rather than partially usable.
  if (entries.length !== expectedCount) {
    throw malformed(
      `Gemini returned ${entries.length} embeddings for ${expectedCount} inputs; order cannot be trusted.`,
    );
  }

  return entries.map((entry, index) => readVector(entry, index, expectedDimensions));
}

function readVector(entry: unknown, index: number, expectedDimensions: number): number[] {
  if (typeof entry !== 'object' || entry === null || !('values' in entry)) {
    throw malformed(`Gemini embedding ${index} had no values.`);
  }

  if (!Array.isArray(entry.values)) {
    throw malformed(`Gemini embedding ${index} values field was not an array.`);
  }

  const values: unknown[] = entry.values;

  if (values.length !== expectedDimensions) {
    throw malformed(
      `Gemini embedding ${index} has ${values.length} dimensions, expected ${expectedDimensions}. Refusing to persist a vector of the wrong width.`,
    );
  }

  const vector = new Array<number>(values.length);

  for (let position = 0; position < values.length; position += 1) {
    const value = values[position];
    // NaN and Infinity survive JSON round-trips through some gateways, and one of
    // them anywhere in a vector makes every distance involving it meaningless.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw malformed(`Gemini embedding ${index} contained a non-numeric value at ${position}.`);
    }
    vector[position] = value;
  }

  return vector;
}

/** Back onto the unit sphere after Matryoshka truncation. */
function normalise(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;

  // A zero vector has no direction to restore. It is also not indexable and has
  // no defined cosine distance, so it must not reach the database.
  if (sumOfSquares === 0) {
    throw malformed('Gemini returned a zero vector, which has no direction to compare against.');
  }

  const norm = Math.sqrt(sumOfSquares);
  return vector.map((value) => value / norm);
}

/**
 * Honest estimates, flagged as estimates.
 *
 * The Gemini Developer API reports no usable per-input token count for
 * embeddings — `ContentEmbeddingStatistics.tokenCount` is documented as Gemini
 * Enterprise Agent Platform only — so this is derived from character length. The
 * flag travels with the number all the way to the usage row, because an owner
 * checking a spend report against their bill deserves to know which figures are
 * measured and which are inferred.
 */
function estimateUsage(texts: readonly string[]): { inputTokens: number; estimated: boolean } {
  const characters = texts.reduce((total, text) => total + text.length, 0);
  return { inputTokens: Math.ceil(characters / APPROX_CHARS_PER_TOKEN), estimated: true };
}

/** An HTTP status off an unknown thrown value, without asserting its shape. */
function readNumericStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('code' in error && typeof error.code === 'number') return error.code;
  return undefined;
}

/**
 * Transport failures classified so the job queue can decide. Retryability is the
 * only thing the caller acts on: a retryable failure must reach the queue as a
 * throw, and a non-retryable one must end as honest missing evidence rather than
 * an answer the model invented.
 */
function toAgentError(error: unknown): AIAgentError {
  // Already ours — re-wrapping would bury the category it was raised with.
  if (error instanceof AIAgentError) return error;

  const status = readNumericStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status === 429) {
    return new AIAgentError(`Gemini embedding rate limited: ${message}`, {
      category: 'RATE_LIMITED',
      retryability: 'RETRYABLE',
      cause: error,
    });
  }

  if (status !== undefined) {
    return new AIAgentError(`Gemini embedding request failed (${status}): ${message}`, {
      category: 'PROVIDER_UNAVAILABLE',
      retryability: status >= 500 ? 'RETRYABLE' : 'NOT_RETRYABLE',
      cause: error,
    });
  }

  // No status: fall back to the shared taxonomy, which recognises timeouts and
  // connection failures by message and is the single place that logic lives.
  const classified = classifyAIError(error);
  return new AIAgentError(`Gemini embedding request failed: ${message}`, {
    category: classified.category === 'TOOL_EXECUTION_FAILURE' ? 'PROVIDER_UNAVAILABLE' : classified.category,
    retryability: classified.retryability,
    cause: error,
  });
}
