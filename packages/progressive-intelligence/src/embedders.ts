/**
 * Embedder helpers — mirrors the deterministic mock in
 * `@borjie/user-context-store` so tests in this package don't need
 * to import a sibling.
 *
 * `createDeterministicMockEmbedder` produces stable embeddings keyed
 * off SHA-256(content). Same input → same vector every run, every
 * process. Useful for tests + dev seed scripts.
 */
import { createHash } from 'crypto';
import type { Embedder } from './types.js';

export interface MockEmbedderOptions {
  /** Vector dimensionality. Defaults to 32 — plenty for tests. */
  readonly dimension?: number;
}

export function createDeterministicMockEmbedder(
  opts: MockEmbedderOptions = {},
): Embedder {
  const dimension = opts.dimension ?? 32;
  return {
    dimension,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const hash = createHash('sha256').update(text).digest();
      const out = new Array<number>(dimension);
      for (let i = 0; i < dimension; i += 1) {
        const byte = hash[i % hash.length] as number;
        out[i] = byte / 127.5 - 1;
      }
      return out;
    },
  };
}
