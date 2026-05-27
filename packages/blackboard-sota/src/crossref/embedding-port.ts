/**
 * Embedding port — pluggable interface for OpenAI
 * `text-embedding-3-large` (1536-dim).
 *
 * Wave BLACKBOARD-CORE. The reference port shape used by the
 * cross-reference detector and the post-publisher's auto-embed
 * helper. Live wiring delegates to the same embedding service that
 * cognitive-memory (Wave 18AA) uses (`text-embedding-3-large`).
 * Tests inject a deterministic fixture (`__fixtures__/embedder.ts`)
 * that returns reproducible vectors from a seeded RNG.
 *
 * No I/O in this file — pure type surface plus a small
 * cosine-similarity utility.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §7.
 */

import { BLACKBOARD_CONSTANTS } from '../types.js';

export interface EmbeddingPort {
  /** Return a 1536-dimensional vector for the given text. */
  embed(text: string): Promise<ReadonlyArray<number>>;
  /** Return the dimensionality this port produces. */
  dim(): number;
}

/**
 * Cosine similarity between two same-dimensional vectors. Returns a
 * value in [-1, 1]; 1 means identical direction. Throws on
 * dimensionality mismatch — callers must use vectors from the same
 * embedding model.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimensionality mismatch — a.length=${a.length} b.length=${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Assert that a vector is exactly the right dimensionality. */
export function assertEmbeddingDim(
  vec: ReadonlyArray<number>,
  expected: number = BLACKBOARD_CONSTANTS.EMBEDDING_DIM,
): void {
  if (vec.length !== expected) {
    throw new Error(
      `Embedding dimensionality mismatch: expected ${expected}, got ${vec.length}`,
    );
  }
}
