/**
 * In-memory `VectorIndex` reference implementation.
 *
 * Wave HARVEST. A tiny embedding stub + cosine-similarity scan over
 * a local map. Used in tests where no live pgvector is available.
 *
 * The "embedding" is a deterministic 64-dim word-bag projection — not
 * meaningful for production but useful for asserting the redundancy
 * pipeline's branching. Production wires pgvector through
 * `@borjie/cognitive-memory`'s embedding service.
 */

import type { VectorIndex } from '../types.js';

const DIM = 64;

function hashToken(token: string): number {
  // FNV-1a 32-bit hash, modulo DIM.
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % DIM;
}

export function projectText(text: string): ReadonlyArray<number> {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return Object.freeze(vec);
  tokens.forEach((t) => {
    const i = hashToken(t);
    vec[i] = (vec[i] ?? 0) + 1;
  });
  let mag = 0;
  for (let i = 0; i < DIM; i += 1) {
    mag += (vec[i] ?? 0) * (vec[i] ?? 0);
  }
  mag = Math.sqrt(mag);
  if (mag === 0) return Object.freeze(vec);
  for (let i = 0; i < DIM; i += 1) {
    vec[i] = (vec[i] ?? 0) / mag;
  }
  return Object.freeze(vec);
}

export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

interface IndexEntry {
  readonly cellId: string;
  readonly tenantId: string;
  readonly vector: ReadonlyArray<number>;
}

export interface InMemoryVectorIndex extends VectorIndex {
  /** Test helper — seed a cell into the index. */
  add(input: {
    readonly tenantId: string;
    readonly cellId: string;
    readonly text: string;
  }): void;
  /** Test helper — empty the index. */
  clear(): void;
}

export function createInMemoryVectorIndex(): InMemoryVectorIndex {
  const entries: IndexEntry[] = [];

  return {
    add(input) {
      entries.push(
        Object.freeze({
          cellId: input.cellId,
          tenantId: input.tenantId,
          vector: projectText(input.text),
        }),
      );
    },

    clear() {
      entries.length = 0;
    },

    async findNearest(input) {
      const query = projectText(input.text);
      let best: { readonly cellId: string; readonly similarity: number } | null = null;
      for (const entry of entries) {
        if (entry.tenantId !== input.tenantId) continue;
        const sim = cosineSimilarity(query, entry.vector);
        if (sim >= input.threshold && (best === null || sim > best.similarity)) {
          best = { cellId: entry.cellId, similarity: sim };
        }
      }
      return best;
    },
  };
}
