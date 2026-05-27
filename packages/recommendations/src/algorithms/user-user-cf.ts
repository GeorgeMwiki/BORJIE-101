/**
 * User-User Collaborative Filtering — pure TypeScript.
 *
 * Steps:
 *   1. Build a user × item rating matrix from the tenant-scoped
 *      interactions.
 *   2. For the target user, compute Pearson similarity to every
 *      other user; require `minOverlap` co-rated items.
 *   3. For each candidate item, predict the rating as a similarity-
 *      weighted average of the K nearest neighbours' ratings,
 *      centred on each neighbour's mean.
 *   4. Sort candidates by predicted rating, tie-break on itemId.
 *
 * Citation: Resnick, Iacovou, Suchak, Bergstrom, Riedl —
 * "GroupLens: An Open Architecture for Collaborative Filtering of
 * Netnews", CSCW 1994 (foundational user-user CF; re-issued in the
 * Recommender Systems Handbook 3rd ed., 2024 — section 4.1).
 */

import type {
  RecommendationPort,
  RecommendationRequest,
  RecommendationResult,
  ScoredItem,
} from '../types.js';
import { pearson } from '../util/linalg.js';
import { sealResult } from '../util/seal.js';

const ALGORITHM = 'user_user_cf' as const;

export interface UserUserCFOptions {
  /** Minimum number of co-rated items needed before similarity counts.
   *  Default 2. */
  readonly minOverlap?: number;
  /** Top-K neighbours to use in the prediction. Default 25. */
  readonly neighbours?: number;
  /** When true, demote items the target user has already rated to the
   *  bottom of the ranking. This is the canonical CF recommendation
   *  semantics — predict what the user has NOT seen. Default true. */
  readonly excludeRatedItems?: boolean;
  /** prevHash for chaining. Default ''. */
  readonly prevHash?: string;
  /** Now-clock override. Default Date.now. */
  readonly now?: () => number;
}

interface UserProfile {
  readonly userId: string;
  readonly ratings: Map<string, number>;
  readonly mean: number;
}

interface SimEntry {
  readonly profile: UserProfile;
  readonly similarity: number;
}

export function createUserUserCFRecommender(
  opts: UserUserCFOptions = {},
): RecommendationPort {
  const minOverlap = opts.minOverlap ?? 2;
  const k = opts.neighbours ?? 25;
  const excludeRated = opts.excludeRatedItems ?? true;
  const now = opts.now ?? ((): number => Date.now());
  const prevHash = opts.prevHash ?? '';

  function recommend(request: RecommendationRequest): RecommendationResult {
    assertTenantConsistency(request);
    const profiles = buildProfiles(request);
    const target = profiles.get(request.userId);
    const candidateIds = request.candidates.map((c) => c.id);
    let scored: ScoredItem[];
    if (!target || target.ratings.size === 0) {
      scored = candidateIds.map((id) => ({
        itemId: id,
        score: 0,
        reason: 'user_user_cf: target has no ratings',
      }));
    } else {
      const sims = computeSimilarities(target, profiles, minOverlap);
      const topNeighbours = sims.slice(0, k);
      scored = candidateIds.map((id) =>
        predictForItem(id, target, topNeighbours),
      );
      if (excludeRated) {
        scored = scored.map((s) =>
          target.ratings.has(s.itemId)
            ? {
                itemId: s.itemId,
                score: -Infinity,
                reason: 'user_user_cf: already rated by target',
              }
            : s,
        );
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

function buildProfiles(
  request: RecommendationRequest,
): Map<string, UserProfile> {
  const byUser = new Map<string, Map<string, number>>();
  for (const ix of request.interactions) {
    if (ix.tenantId !== request.tenantId) continue;
    let row = byUser.get(ix.userId);
    if (!row) {
      row = new Map<string, number>();
      byUser.set(ix.userId, row);
    }
    row.set(ix.itemId, ix.rating);
  }
  const out = new Map<string, UserProfile>();
  for (const [userId, ratings] of byUser) {
    let sum = 0;
    for (const v of ratings.values()) sum += v;
    const mean = ratings.size === 0 ? 0 : sum / ratings.size;
    out.set(userId, { userId, ratings, mean });
  }
  return out;
}

function computeSimilarities(
  target: UserProfile,
  profiles: Map<string, UserProfile>,
  minOverlap: number,
): SimEntry[] {
  const out: SimEntry[] = [];
  for (const [userId, profile] of profiles) {
    if (userId === target.userId) continue;
    const a: number[] = [];
    const b: number[] = [];
    for (const [itemId, rating] of target.ratings) {
      const other = profile.ratings.get(itemId);
      if (other === undefined) continue;
      a.push(rating);
      b.push(other);
    }
    if (a.length < minOverlap) continue;
    const sim = pearson(a, b);
    out.push({ profile, similarity: sim });
  }
  out.sort((p, q) => q.similarity - p.similarity);
  return out;
}

function predictForItem(
  itemId: string,
  target: UserProfile,
  neighbours: ReadonlyArray<SimEntry>,
): ScoredItem {
  let num = 0;
  let den = 0;
  let used = 0;
  for (const n of neighbours) {
    const r = n.profile.ratings.get(itemId);
    if (r === undefined) continue;
    if (n.similarity <= 0) continue;
    num += n.similarity * (r - n.profile.mean);
    den += Math.abs(n.similarity);
    used += 1;
  }
  if (den === 0 || used === 0) {
    return {
      itemId,
      score: target.mean,
      reason: 'user_user_cf: fallback to user mean',
    };
  }
  return {
    itemId,
    score: target.mean + num / den,
    reason: `user_user_cf: ${used} neighbours`,
  };
}

function assertTenantConsistency(request: RecommendationRequest): void {
  for (const item of request.candidates) {
    if (item.tenantId !== request.tenantId) {
      throw new Error(
        `user_user_cf: candidate ${item.id} tenant ${item.tenantId} != request tenant ${request.tenantId}`,
      );
    }
  }
}
