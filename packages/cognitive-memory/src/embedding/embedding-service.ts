/**
 * Embedding service wrapper (Wave 18W).
 *
 * Wraps an upstream embedder (e.g. OpenAI text-embedding-3-large) with:
 *   - hard budget gate (rejects when monthly $ cap is exceeded);
 *   - 30-day cache (see embedding-cache.ts);
 *   - dimension validation against EMBEDDING_DIM.
 *
 * The package itself does NOT take a hard dep on OpenAI — the host
 * wires the upstream embedder via the `UpstreamEmbedder` port. This
 * keeps the package usable from server contexts that already manage
 * the OpenAI client (and lets tests inject a deterministic vector
 * generator).
 */

import { CognitiveMemoryError, EMBEDDING_DIM, type EmbeddingService } from '../types.js';
import { createEmbeddingCache, type EmbeddingCache } from './embedding-cache.js';

export interface UpstreamEmbedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

export interface EmbeddingBudgetGate {
  /** Returns true if budget is exhausted for the current window. */
  isExhausted(): boolean;
  /** Record a successful embed call. */
  recordCall(approximate_tokens: number): void;
}

export interface EmbeddingServiceOptions {
  readonly upstream: UpstreamEmbedder;
  readonly cache?: EmbeddingCache;
  readonly budget_gate?: EmbeddingBudgetGate;
  readonly approximate_tokens?: (text: string) => number;
}

function defaultApproxTokens(text: string): number {
  // OpenAI rule-of-thumb: ~4 chars per token; minimum 1.
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createEmbeddingService(opts: EmbeddingServiceOptions): EmbeddingService {
  const cache: EmbeddingCache = opts.cache ?? createEmbeddingCache();
  const approximate_tokens: (text: string) => number =
    opts.approximate_tokens ?? defaultApproxTokens;

  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      if (text.length === 0) {
        throw new CognitiveMemoryError(
          'embedding.empty_input',
          'cannot embed empty string',
        );
      }
      const cached = cache.lookup(text);
      if (cached !== null) {
        return cached;
      }
      if (opts.budget_gate !== undefined && opts.budget_gate.isExhausted()) {
        throw new CognitiveMemoryError(
          'embedding.budget_exhausted',
          'embedding budget exhausted for window — observe call rejected',
        );
      }
      const result = await opts.upstream.embed(text);
      if (result.length !== EMBEDDING_DIM) {
        throw new CognitiveMemoryError(
          'embedding.dim_mismatch',
          `expected ${EMBEDDING_DIM}-dim embedding, got ${result.length}`,
          { actual: result.length, expected: EMBEDDING_DIM },
        );
      }
      cache.remember(text, result);
      if (opts.budget_gate !== undefined) {
        opts.budget_gate.recordCall(approximate_tokens(text));
      }
      return result;
    },
  };
}
