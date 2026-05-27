/**
 * Local Outlier Factor (LOF).
 *
 * Pure-TypeScript port of Breunig, M. M., Kriegel, H.-P., Ng, R. T. &
 * Sander, J. (2000). *LOF: Identifying Density-Based Local Outliers.*
 * SIGMOD 2000. DOI: 10.1145/342009.335388.
 *
 * Definitions (from the paper):
 *
 *   k-distance(p)         = distance from p to its k-th nearest neighbour
 *   N_k(p)                = set of points within k-distance(p) of p
 *   reach-dist_k(p, o)    = max(k-distance(o), d(p, o))
 *   lrd_k(p)              = 1 / (sum_{o ∈ N_k(p)} reach-dist_k(p, o) / |N_k(p)|)
 *   LOF_k(p)              = (1 / |N_k(p)|) · sum_{o ∈ N_k(p)} lrd_k(o) / lrd_k(p)
 *
 * Interpretation: `LOF ≈ 1` means inlier (point density matches its
 * neighbourhood); `LOF ≫ 1` means outlier (point density is much
 * lower than neighbours'). Default decision threshold is 1.5.
 *
 * @module @borjie/anomaly-detection/detectors/local-outlier-factor
 */

import type { AnomalyScore, LocalOutlierFactorConfig } from '../types.js';

const DEFAULT_K = 20;
const DEFAULT_THRESHOLD = 1.5;

function euclidean(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * For every row, find the `k` nearest neighbour indices and their
 * distances. O(n²) — fine for our typical batch sizes (a few thousand
 * accelerometer samples).
 */
function kNearestForAll(
  data: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
): ReadonlyArray<{
  readonly indices: ReadonlyArray<number>;
  readonly distances: ReadonlyArray<number>;
  readonly kDistance: number;
}> {
  const n = data.length;
  const result: Array<{
    indices: ReadonlyArray<number>;
    distances: ReadonlyArray<number>;
    kDistance: number;
  }> = [];
  for (let i = 0; i < n; i += 1) {
    const pairs: Array<{ idx: number; dist: number }> = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      pairs.push({ idx: j, dist: euclidean(data[i]!, data[j]!) });
    }
    pairs.sort((p, q) => p.dist - q.dist);
    const top = pairs.slice(0, k);
    result.push({
      indices: top.map((p) => p.idx),
      distances: top.map((p) => p.dist),
      kDistance: top[top.length - 1]!.dist,
    });
  }
  return result;
}

export interface LofResult {
  readonly scores: ReadonlyArray<AnomalyScore>;
  readonly lrds: ReadonlyArray<number>;
}

/**
 * Compute LOF scores for every row of `data`.
 */
export function detectLocalOutlierFactor(
  data: ReadonlyArray<ReadonlyArray<number>>,
  config: LocalOutlierFactorConfig = {},
): LofResult {
  const k = config.k ?? DEFAULT_K;
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  if (data.length <= k) {
    throw new Error(
      `detectLocalOutlierFactor: need more than k=${k} rows, got ${data.length}`,
    );
  }
  const dims = data[0]!.length;
  for (const row of data) {
    if (row.length !== dims) {
      throw new Error('detectLocalOutlierFactor: inconsistent row dimensions');
    }
  }
  const neighbourhoods = kNearestForAll(data, k);

  // reach-dist(p, o) = max(k-distance(o), d(p, o))
  // lrd(p) = 1 / (mean_{o ∈ N_k(p)} reach-dist(p, o))
  const lrds: number[] = [];
  for (let p = 0; p < data.length; p += 1) {
    const nbrs = neighbourhoods[p]!;
    let sum = 0;
    for (let q = 0; q < nbrs.indices.length; q += 1) {
      const oIdx = nbrs.indices[q]!;
      const dPO = nbrs.distances[q]!;
      const kDistO = neighbourhoods[oIdx]!.kDistance;
      sum += Math.max(kDistO, dPO);
    }
    const meanReach = sum / nbrs.indices.length;
    // If meanReach is 0 (duplicate points), treat density as infinite
    // → LOF will be 0 for surrounding points and inlier-ish. We map
    // 0 to a tiny epsilon to avoid division-by-zero downstream.
    lrds.push(meanReach === 0 ? Infinity : 1 / meanReach);
  }

  // LOF(p) = (1/|N|) sum lrd(o) / lrd(p)
  const scores: AnomalyScore[] = [];
  for (let p = 0; p < data.length; p += 1) {
    const nbrs = neighbourhoods[p]!;
    let sum = 0;
    for (const oIdx of nbrs.indices) {
      const lrdO = lrds[oIdx]!;
      sum += lrdO;
    }
    const lof =
      lrds[p]! === 0 || !Number.isFinite(lrds[p]!)
        ? 0
        : sum / nbrs.indices.length / lrds[p]!;
    scores.push(
      Object.freeze({
        value: data[p]![0]!,
        score: lof,
        scoreKind: 'lof' as const,
        threshold,
        anomalous: lof >= threshold,
      }),
    );
  }
  return Object.freeze({ scores, lrds });
}
