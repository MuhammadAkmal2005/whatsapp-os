/**
 * Provider-neutral Embedding Interface.
 */
export interface EmbeddingResult {
  embedding: number[];
  usage: {
    inputTokens: number;
  };
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string, model: string): Promise<EmbeddingResult>;
}
