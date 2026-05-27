/**
 * Matrix factorization — SGD-style low-rank factorization of the
 * tenant-scoped user × item interaction matrix.
 *
 * Strategy:
 *   R ≈ P Q^T
 *   where P is users × k and Q is items × k. We minimise
 *      sum_{(u,i) observed} (r_{ui} - p_u · q_i)^2
 *                + lambda (||p_u||^2 + ||q_i||^2)
 *   via batched stochastic gradient descent. The result is the
 *   classical SVD-with-regularization model that won the Netflix
 *   Prize — implemented in pure TS so the package has zero native
 *   matrix deps. (An `ml-matrix` adapter is a drop-in port behind
 *   the same `RecommendationPort` interface; ship it once the
 *   workspace picks up that dep.)
 *
 * Citation: Koren, Bell, Volinsky — "Matrix Factorization Techniques
 * for Recommender Systems", IEEE Computer 42(8), 2009. The canonical
 * baseline against which every neural recommender is benchmarked
 * (re-issued in the Recommender Systems Handbook 3rd ed., 2024).
 *
 * Determinism: under a fixed `seed` the SGD initialiser and update
 * order produce a byte-identical model.
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
} from '../types.js';
import { dot } from '../util/linalg.js';
import { createPRNG } from '../util/prng.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'matrix_factorization' as const;

export interface MatrixFactorizationOptions {
  /** Latent factor count. Default 16. */
  readonly factors?: number;
  /** Learning rate. Default 0.02. */
  readonly learningRate?: number;
  /** L2 regularization strength. Default 0.02. */
  readonly regularization?: number;
  /** Number of SGD passes over the interaction set. Default 50. */
  readonly iterations?: number;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

export function createMatrixFactorizationRecommender(
  opts: MatrixFactorizationOptions = {},
): RecommendationPort {
  const factors = opts.factors ?? 16;
  const lr = opts.learningRate ?? 0.02;
  const reg = opts.regularization ?? 0.02;
  const iterations = opts.iterations ?? 50;
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const candidateIds = request.candidates.map((c) => c.id);
    const seed = request.seed ?? 0xc0ffee;
    const prng = createPRNG(seed);

    // Build user / item index sets restricted to this tenant.
    const userIndex = new Map<string, number>();
    const itemIndex = new Map<string, number>();
    const filtered: Array<{ u: number; i: number; r: number }> = [];
    for (const ix of request.interactions) {
      if (ix.tenantId !== request.tenantId) continue;
      let u = userIndex.get(ix.userId);
      if (u === undefined) {
        u = userIndex.size;
        userIndex.set(ix.userId, u);
      }
      let i = itemIndex.get(ix.itemId);
      if (i === undefined) {
        i = itemIndex.size;
        itemIndex.set(ix.itemId, i);
      }
      filtered.push({ u, i, r: ix.rating });
    }

    // Ensure all candidates have an item-index even if absent from
    // interactions (cold items get a zero score, not an error).
    for (const id of candidateIds) {
      if (!itemIndex.has(id)) {
        itemIndex.set(id, itemIndex.size);
      }
    }

    // Ensure the target user has an index too.
    if (!userIndex.has(request.userId)) {
      userIndex.set(request.userId, userIndex.size);
    }

    const nUsers = userIndex.size;
    const nItems = itemIndex.size;

    let scored: ScoredItem[];
    if (filtered.length === 0) {
      scored = candidateIds.map((id) => ({
        itemId: id,
        score: 0,
        reason: 'matrix_factorization: no interactions',
      }));
    } else {
      // Initialise P and Q with small Gaussian noise — scale by
      // 1/sqrt(factors) to keep dot products near zero at init.
      const init = 1 / Math.sqrt(factors);
      const P: number[][] = new Array(nUsers);
      for (let u = 0; u < nUsers; u += 1) {
        const row = new Array<number>(factors);
        for (let f = 0; f < factors; f += 1) row[f] = prng.nextGaussian() * init;
        P[u] = row;
      }
      const Q: number[][] = new Array(nItems);
      for (let i = 0; i < nItems; i += 1) {
        const row = new Array<number>(factors);
        for (let f = 0; f < factors; f += 1) row[f] = prng.nextGaussian() * init;
        Q[i] = row;
      }

      // SGD passes. Deterministic order: sorted by (u, i).
      const passes = [...filtered].sort((a, b) => a.u - b.u || a.i - b.i);
      for (let iter = 0; iter < iterations; iter += 1) {
        for (const { u, i, r } of passes) {
          const pu = P[u] as number[];
          const qi = Q[i] as number[];
          const pred = dot(pu, qi);
          const err = r - pred;
          for (let f = 0; f < factors; f += 1) {
            const puf = pu[f] as number;
            const qif = qi[f] as number;
            pu[f] = puf + lr * (err * qif - reg * puf);
            qi[f] = qif + lr * (err * puf - reg * qif);
          }
        }
      }

      const uIdx = userIndex.get(request.userId);
      if (uIdx === undefined) {
        scored = candidateIds.map((id) => ({
          itemId: id,
          score: 0,
          reason: 'matrix_factorization: target unindexed',
        }));
      } else {
        const pu = P[uIdx] as number[];
        scored = candidateIds.map((id) => {
          const idx = itemIndex.get(id);
          if (idx === undefined) {
            return {
              itemId: id,
              score: 0,
              reason: 'matrix_factorization: item unindexed',
            };
          }
          const qi = Q[idx] as number[];
          return {
            itemId: id,
            score: dot(pu, qi),
            reason: 'matrix_factorization',
          };
        });
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
    });
    const topK = scored.slice(0, Math.max(0, request.topK));
    return sealResult({
      tenantId: request.tenantId,
      target: request.target,
      algorithm: ALGORITHM,
      userId: request.userId,
      topK,
      candidates: candidateIds,
      servedAt: now(),
      prevHash,
    });
  }

  return { algorithm: ALGORITHM, recommend };
}

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `matrix_factorization: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
}
