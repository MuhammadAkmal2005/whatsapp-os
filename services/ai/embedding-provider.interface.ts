/**
 * Provider-neutral embedding contract.
 *
 * Everything above this line in the stack — grounding, retrieval, metering —
 * speaks only in these terms. No Gemini type, no Gemini vocabulary, and no model
 * name chosen by a caller: swapping the provider should be a change in one
 * factory, not a change in every call site.
 */

/**
 * Whether a vector describes a stored document or a search query.
 *
 * Modern embedding models are asymmetric — the same sentence embedded as a
 * document and as a query lands in a different place, and comparing a
 * query-embedded query against document-embedded chunks is exactly what they were
 * trained for. Two words of our own rather than the provider's vocabulary, so a
 * string like `RETRIEVAL_DOCUMENT` never travels through application code; the
 * adapter translates at the boundary.
 */
export type EmbeddingTask = 'document' | 'query';

export interface EmbeddingUsage {
  /** Input tokens attributed to the call. Embeddings have no output tokens. */
  inputTokens: number;

  /**
   * True when `inputTokens` was computed locally rather than reported by the
   * provider, and it is not decoration. The Gemini Developer API returns no
   * usable per-input token count for embeddings, so the adapter estimates from
   * character length. Metering carries the flag through to the usage row, because
   * a spend report that presents an estimate as a metered figure is lying about
   * the one number an owner checks against their bill.
   */
  estimated: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  usage: EmbeddingUsage;
}

export interface EmbeddingBatchResult {
  /** One vector per input, in the order the inputs were given. */
  embeddings: number[][];
  /** Usage for the batch as a whole, not per input. */
  usage: EmbeddingUsage;
}

export interface EmbeddingProvider {
  /** Identifies the adapter in logs and usage rows. */
  readonly name: string;

  /**
   * The model this provider resolved from configuration, for provenance and
   * pricing. Not a parameter on `embed`: a corpus embedded by two models at once
   * is a corpus whose distances mean nothing, so the model is fixed when the
   * provider is constructed and every vector it produces reports the same one.
   */
  readonly model: string;

  /** Width of every vector this provider returns. */
  readonly dimensions: number;

  embed(text: string, task: EmbeddingTask): Promise<EmbeddingResult>;

  /**
   * One request, many independent texts — not a loop over `embed`. Ingesting a
   * document produces dozens of chunks, and N round trips is N times the latency
   * and N times the rate-limit exposure for the same work.
   *
   * Implementations must return vectors positionally matched to `texts`; callers
   * pair them by index with no other correlation available.
   */
  embedMany(texts: readonly string[], task: EmbeddingTask): Promise<EmbeddingBatchResult>;
}
