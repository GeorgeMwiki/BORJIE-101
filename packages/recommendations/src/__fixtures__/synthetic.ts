/**
 * Deterministic fixtures for @borjie/recommendations tests.
 *
 * Every test in this package builds its input from this module so a
 * single seed change is a single grep. Synthetic interactions are used
 * to validate algorithmic correctness — Thompson Sampling regret,
 * matrix-factorization reconstruction of a known low-rank matrix, MMR
 * picking diverse items — but never to fabricate production output
 * (the live-test-only invariant from FOUNDER_LOCKED_DECISIONS_2026_05_26).
 */

import type {
  EmbeddingVector,
  Interaction,
  Item,
  RecommendationRequest,
} from '../types.js';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export interface SyntheticCorpus {
  readonly tenantId: string;
  readonly users: ReadonlyArray<string>;
  readonly items: ReadonlyArray<Item>;
  readonly interactions: ReadonlyArray<Interaction>;
}

function emb(
  tenantId: string,
  id: string,
  values: ReadonlyArray<number>,
): EmbeddingVector {
  return { tenantId, id, values };
}

/**
 * Builds a 5-user × 5-item corpus where users {u0,u1} like items
 * {m0,m1,m2}; users {u2,u3} like {m3,m4}; user u4 has no positive
 * interactions yet (a cold-start case). Embeddings cluster around the
 * same axes — items {m0,m1,m2} have positive x; items {m3,m4} have
 * positive y — so content-based on (u0,u1) should pick m0,m1,m2 and
 * on (u2,u3) should pick m3,m4.
 */
export function buildClusterCorpus(
  tenantId: string = TENANT_A,
): SyntheticCorpus {
  const users = ['u0', 'u1', 'u2', 'u3', 'u4'] as const;
  const items: Item[] = [
    { tenantId, id: 'm0', embedding: emb(tenantId, 'm0', [1.0, 0.0]) },
    { tenantId, id: 'm1', embedding: emb(tenantId, 'm1', [0.9, 0.1]) },
    { tenantId, id: 'm2', embedding: emb(tenantId, 'm2', [0.8, 0.2]) },
    { tenantId, id: 'm3', embedding: emb(tenantId, 'm3', [0.0, 1.0]) },
    { tenantId, id: 'm4', embedding: emb(tenantId, 'm4', [0.1, 0.9]) },
  ];
  const interactions: Interaction[] = [];
  const now = 1_700_000_000_000;
  // u0, u1 ↔ m0, m1, m2 — high rating
  for (const u of ['u0', 'u1']) {
    for (const itemId of ['m0', 'm1', 'm2']) {
      interactions.push({
        tenantId,
        userId: u,
        itemId,
        rating: 1.0,
        timestamp: now,
      });
    }
  }
  // u2, u3 ↔ m3, m4 — high rating
  for (const u of ['u2', 'u3']) {
    for (const itemId of ['m3', 'm4']) {
      interactions.push({
        tenantId,
        userId: u,
        itemId,
        rating: 1.0,
        timestamp: now,
      });
    }
  }
  // m0 is overwhelmingly popular (extra phantom interactions from u2)
  interactions.push({
    tenantId,
    userId: 'u2',
    itemId: 'm0',
    rating: 1.0,
    timestamp: now,
  });
  interactions.push({
    tenantId,
    userId: 'u3',
    itemId: 'm0',
    rating: 1.0,
    timestamp: now,
  });
  // u4 has no interactions — cold-start case.
  return { tenantId, users: [...users], items, interactions };
}

/** Build a minimal RecommendationRequest from a corpus. */
export function buildRequest(args: {
  readonly corpus: SyntheticCorpus;
  readonly userId: string;
  readonly target?: RecommendationRequest['target'];
  readonly topK?: number;
  readonly seed?: number;
}): RecommendationRequest {
  return {
    tenantId: args.corpus.tenantId,
    target: args.target ?? 'buyer_mine',
    userId: args.userId,
    candidates: args.corpus.items,
    interactions: args.corpus.interactions,
    topK: args.topK ?? 3,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
  };
}

/**
 * Generate a low-rank ground-truth rating matrix and return the
 * observed interactions for matrix-factorization reconstruction.
 * Each user u and item i has a known 2-dimensional latent vector;
 * the rating is the dot product clipped to [0, 5]. We observe a
 * dense subset so SGD has signal to recover the latent factors.
 */
export function buildLowRankCorpus(args: {
  readonly tenantId: string;
  readonly nUsers: number;
  readonly nItems: number;
}): {
  readonly users: ReadonlyArray<{ id: string; vec: ReadonlyArray<number> }>;
  readonly items: ReadonlyArray<{ id: string; vec: ReadonlyArray<number> }>;
  readonly interactions: ReadonlyArray<Interaction>;
  readonly candidates: ReadonlyArray<Item>;
} {
  const { tenantId, nUsers, nItems } = args;
  const users: Array<{ id: string; vec: ReadonlyArray<number> }> = [];
  const items: Array<{ id: string; vec: ReadonlyArray<number> }> = [];
  for (let u = 0; u < nUsers; u += 1) {
    // Two clusters: even-indexed users prefer axis 0, odd prefer axis 1.
    const v = u % 2 === 0 ? [1.0, 0.2] : [0.2, 1.0];
    users.push({ id: `u${u}`, vec: v });
  }
  for (let i = 0; i < nItems; i += 1) {
    const v = i % 2 === 0 ? [1.0, 0.1] : [0.1, 1.0];
    items.push({ id: `m${i}`, vec: v });
  }
  const interactions: Interaction[] = [];
  const now = 1_700_000_000_000;
  for (let u = 0; u < nUsers; u += 1) {
    const userVec = users[u]!.vec;
    for (let i = 0; i < nItems; i += 1) {
      const itemVec = items[i]!.vec;
      const r = userVec[0]! * itemVec[0]! + userVec[1]! * itemVec[1]!;
      // Observe ~80% of cells deterministically (positional sample).
      if ((u * nItems + i) % 5 !== 4) {
        interactions.push({
          tenantId,
          userId: `u${u}`,
          itemId: `m${i}`,
          rating: r,
          timestamp: now,
        });
      }
    }
  }
  const candidates: Item[] = items.map((it) => ({
    tenantId,
    id: it.id,
    embedding: emb(tenantId, it.id, it.vec),
  }));
  return { users, items, interactions, candidates };
}
