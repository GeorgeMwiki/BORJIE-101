/**
 * Two-Tower retriever port.
 *
 * The two-tower architecture factorises the retrieval graph into a
 * user-tower and an item-tower that share an embedding space —
 * Google's production pattern for large-corpus retrieval. We expose
 * it here as a port so a tenant can wire its own external inference
 * sidecar (or a TFLite / ONNX runtime) without changing the
 * recommendation surface.
 *
 * The deterministic in-process default uses the user / item
 * embeddings already attached to the request (set by an upstream
 * embedding service) and scores by dot product — the same operation
 * the production tower would perform.
 *
 * Citation: Yi, Yang, Hong et al. — "Sampling-Bias-Corrected Neural
 * Modeling for Large Corpus Item Recommendations", RecSys 2019;
 * re-issued in the Recommender Systems Handbook 3rd ed., 2024 as
 * the canonical Google production pattern.
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
} from '../types.js';
import { dot } from '../util/linalg.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'two_tower' as const;

export interface TwoTowerPort {
  embedUser(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly features?: Readonly<Record<string, number | string>>;
  }): ReadonlyArray<number>;
  embedItem(args: {
    readonly tenantId: string;
    readonly itemId: string;
    readonly features?: Readonly<Record<string, number | string>>;
  }): ReadonlyArray<number>;
}

export interface TwoTowerOptions {
  /** The injected retriever. Tests pass a deterministic mock. */
  readonly tower: TwoTowerPort;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

export function createTwoTowerRecommender(
  opts: TwoTowerOptions,
): RecommendationPort {
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const userVec = opts.tower.embedUser({
      tenantId: request.tenantId,
      userId: request.userId,
      ...(request.user?.features !== undefined
        ? { features: request.user.features }
        : {}),
    });
    const candidateIds = request.candidates.map((c) => c.id);
    const scored = request.candidates.map((c) => {
      const itemVec = opts.tower.embedItem({
        tenantId: request.tenantId,
        itemId: c.id,
        ...(c.features !== undefined ? { features: c.features } : {}),
      });
      if (itemVec.length !== userVec.length) {
        throw new Error(
          `two_tower: item ${c.id} embedding dim ${itemVec.length} != user dim ${userVec.length}`,
        );
      }
      return {
        itemId: c.id,
        score: dot(userVec, itemVec),
        reason: 'two_tower: dot(user, item)',
      };
    });
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

/**
 * Deterministic mock — hashes (id, tenant) into a d-dimensional
 * vector. Tenant-scoped: the same `itemId` under two different
 * tenants produces two different embeddings, so there is no
 * cross-tenant leak even if the caller wires the same mock for
 * multiple tenants.
 */
export function createDeterministicMockTwoTower(d = 8): TwoTowerPort {
  function hashEmbed(seed: string): number[] {
    const out = new Array<number>(d).fill(0);
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    for (let i = 0; i < d; i += 1) {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      h |= 0;
      out[i] = ((h >>> 0) / 4294967295) * 2 - 1;
    }
    return out;
  }
  return {
    embedUser: ({ tenantId, userId }): number[] =>
      hashEmbed(`u|${tenantId}|${userId}`),
    embedItem: ({ tenantId, itemId }): number[] =>
      hashEmbed(`i|${tenantId}|${itemId}`),
  };
}

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `two_tower: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
}
