/**
 * Deterministic embedding fixtures — BLACKBOARD-INTEL.
 *
 * Tiny 8-dim vectors we can compute by hand. The dense-search tests
 * use these instead of the real 1536-d port so the suite stays
 * reproducible without network calls.
 *
 * @module @borjie/blackboard-intel/__fixtures__/deterministic-embeddings
 */

import { EMBEDDING_DIM, type EmbeddingPort } from '../types.js';

/**
 * Project a tiny 8-d fixture vector up to the full
 * `EMBEDDING_DIM` (1536) so the embedding port honours the
 * production contract. Padding is zero — cosine similarity over the
 * padded vectors is identical to cosine over the 8-d originals
 * (since dot product is unchanged and magnitudes only grow if a
 * non-zero is inserted, which we never do).
 */
export function pad1536(eightDim: ReadonlyArray<number>): ReadonlyArray<number> {
  if (eightDim.length !== 8) {
    throw new Error('pad1536 expects an 8-dim seed vector');
  }
  const out = new Array<number>(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < 8; i += 1) {
    out[i] = eightDim[i] ?? 0;
  }
  return Object.freeze([...out]);
}

/**
 * Eight named fixture vectors. Pairs (V_A, V_A_NEAR) are near-
 * cosines (similarity ~ 0.99). Pairs (V_A, V_B) are nearly
 * orthogonal (similarity ~ 0).
 */
export const V_A: ReadonlyArray<number> = pad1536([1, 0, 0, 0, 0, 0, 0, 0]);
export const V_A_NEAR: ReadonlyArray<number> = pad1536([
  1,
  0.1,
  0,
  0,
  0,
  0,
  0,
  0,
]);
export const V_B: ReadonlyArray<number> = pad1536([0, 1, 0, 0, 0, 0, 0, 0]);
export const V_C: ReadonlyArray<number> = pad1536([0, 0, 1, 0, 0, 0, 0, 0]);

/**
 * Fixture embedding port — returns `V_A` for any query containing
 * the substring "fuel", `V_B` for queries containing "weight", and
 * `V_C` otherwise. Stable and deterministic.
 */
export function createFixtureEmbeddingPort(): EmbeddingPort {
  return {
    async embed(text: string) {
      const lower = text.toLowerCase();
      if (lower.includes('fuel')) return V_A;
      if (lower.includes('weight')) return V_B;
      return V_C;
    },
  };
}

/**
 * Test-only embedding port that ignores all text and returns the
 * supplied vector. Used by the cross-tenant rejection test.
 */
export function createConstantEmbeddingPort(
  v: ReadonlyArray<number>,
): EmbeddingPort {
  return {
    async embed() {
      return v;
    },
  };
}
