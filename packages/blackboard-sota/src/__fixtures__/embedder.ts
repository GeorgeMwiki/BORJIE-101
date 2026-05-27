/**
 * Deterministic embedding fixture — seeded RNG to produce reproducible
 * vectors for tests.
 *
 * Wave BLACKBOARD-CORE. The crossref detector + post publisher use
 * the `EmbeddingPort` interface. Production wires OpenAI
 * `text-embedding-3-large` (1536-dim). Tests inject this fixture so
 * the same text always produces the same vector and the cosine
 * similarities are deterministic.
 *
 * Algorithm:
 *
 *   1. Hash the input string into 64 bits (xorshift-prepared seed).
 *   2. Run a Mulberry32 PRNG seeded by that hash.
 *   3. Emit `dim` values in [-1, 1].
 *   4. Optionally — for tests that want two phrasings to embed
 *      similarly — bias the first few dimensions by token overlap.
 */

import type { EmbeddingPort } from '../crossref/embedding-port.js';
import { BLACKBOARD_CONSTANTS } from '../types.js';

const EMBEDDING_DIM = BLACKBOARD_CONSTANTS.EMBEDDING_DIM;

function fnvHash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tokenise loosely for the overlap bias. We DON'T need a real
 * tokenizer — just enough to make "borehole reading 412 ppm" and
 * "the borehole reading is 412 ppm" embed similar to each other in
 * the test fixture.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((s) => s.length > 0);
}

export function createDeterministicEmbedder(
  options: { readonly dim?: number; readonly overlapBoost?: number } = {},
): EmbeddingPort {
  const dim = options.dim ?? EMBEDDING_DIM;
  const overlapBoost = options.overlapBoost ?? 0.4;

  return {
    dim: () => dim,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const seed = fnvHash32(text);
      const rng = mulberry32(seed);
      const vec = new Array<number>(dim);
      for (let i = 0; i < dim; i += 1) {
        vec[i] = (rng() - 0.5) * 2;
      }

      // Token-overlap bias: project tokens into the first 64 dims.
      // Phrasing variants of the same content share tokens and thus
      // share a bias in those dimensions → their cosine similarity
      // rises predictably above the 0.85 threshold without our
      // tests needing a real embedding model.
      const toks = tokens(text);
      const tokDimSpan = Math.min(64, dim);
      for (const tok of toks) {
        const tokSeed = fnvHash32(`tok:${tok}`);
        const tokRng = mulberry32(tokSeed);
        for (let i = 0; i < tokDimSpan; i += 1) {
          const v = vec[i] ?? 0;
          vec[i] = v + tokRng() * overlapBoost;
        }
      }

      // Normalise to unit length so cosine == dot product.
      let norm = 0;
      for (let i = 0; i < dim; i += 1) {
        const v = vec[i] ?? 0;
        norm += v * v;
      }
      const inv = norm > 0 ? 1 / Math.sqrt(norm) : 1;
      for (let i = 0; i < dim; i += 1) {
        vec[i] = (vec[i] ?? 0) * inv;
      }
      return vec;
    },
  };
}
