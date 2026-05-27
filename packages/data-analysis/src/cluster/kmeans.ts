/**
 * k-means with k-means++ seeding and squared-Euclidean distance.
 *
 * References:
 *   - Lloyd, S. P. (1982). *Least squares quantization in PCM.*
 *     IEEE Transactions on Information Theory 28(2):129-137.
 *     URL: <https://doi.org/10.1109/TIT.1982.1056489>. Date checked: 2026-05-27.
 *   - Arthur, D. & Vassilvitskii, S. (2007). *k-means++: The advantages
 *     of careful seeding.* SODA 2007.
 *     URL: <https://dl.acm.org/doi/10.5555/1283383.1283494>. Date checked: 2026-05-27.
 */

import type { ClusterAssignment } from '../types.js';
import { mulberry32, type Prng } from '../util/rng.js';

function sqDist(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return s;
}

function kmeansPlusPlusSeed(
  X: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
  rng: Prng,
): number[][] {
  const n = X.length;
  const idx0 = Math.floor(rng() * n);
  const centers: number[][] = [[...(X[idx0] as ReadonlyArray<number>)]];
  const dists = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    dists[i] = sqDist(X[i] as ReadonlyArray<number>, centers[0] as ReadonlyArray<number>);
  }
  while (centers.length < k) {
    let total = 0;
    for (const d of dists) total += d;
    if (total === 0) {
      // All points coincide with chosen centers — pick any.
      centers.push([...(X[Math.floor(rng() * n)] as ReadonlyArray<number>)]);
      continue;
    }
    let target = rng() * total;
    let chosen = 0;
    for (let i = 0; i < n; i += 1) {
      target -= dists[i] as number;
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centers.push([...(X[chosen] as ReadonlyArray<number>)]);
    for (let i = 0; i < n; i += 1) {
      const d = sqDist(
        X[i] as ReadonlyArray<number>,
        centers[centers.length - 1] as ReadonlyArray<number>,
      );
      if (d < (dists[i] as number)) dists[i] = d;
    }
  }
  return centers;
}

export interface KMeansOptions {
  readonly maxIter?: number;
  readonly tol?: number;
  readonly seed?: number;
}

export function kmeans(
  X: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
  opts: KMeansOptions = {},
): ClusterAssignment {
  if (k < 1) throw new Error('kmeans: k must be ≥ 1');
  if (X.length < k) throw new Error('kmeans: need n ≥ k');
  const dim = (X[0] as ReadonlyArray<number>).length;
  for (const row of X) {
    if (row.length !== dim) throw new Error('kmeans: ragged input');
  }
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-6;
  const rng = mulberry32(opts.seed);
  let centers = kmeansPlusPlusSeed(X, k, rng);
  const labels = new Array<number>(X.length).fill(0);
  let iter = 0;
  let converged = false;
  for (iter = 0; iter < maxIter; iter += 1) {
    // Assign
    let changed = 0;
    for (let i = 0; i < X.length; i += 1) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c += 1) {
        const d = sqDist(
          X[i] as ReadonlyArray<number>,
          centers[c] as ReadonlyArray<number>,
        );
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if ((labels[i] as number) !== best) changed += 1;
      labels[i] = best;
    }
    // Update centers
    const sums: number[][] = [];
    const counts = new Array<number>(k).fill(0);
    for (let c = 0; c < k; c += 1) {
      sums.push(new Array<number>(dim).fill(0));
    }
    for (let i = 0; i < X.length; i += 1) {
      const lab = labels[i] as number;
      counts[lab] = (counts[lab] as number) + 1;
      const row = X[i] as ReadonlyArray<number>;
      const sumRow = sums[lab] as number[];
      for (let d = 0; d < dim; d += 1) {
        sumRow[d] = (sumRow[d] as number) + (row[d] as number);
      }
    }
    const newCenters: number[][] = [];
    let shift = 0;
    for (let c = 0; c < k; c += 1) {
      const cnt = counts[c] as number;
      const center: number[] = [];
      const sumRow = sums[c] as number[];
      if (cnt === 0) {
        // Re-seed empty cluster to a random point.
        const fallback = X[Math.floor(rng() * X.length)] as ReadonlyArray<number>;
        center.push(...fallback);
      } else {
        for (let d = 0; d < dim; d += 1) {
          center.push((sumRow[d] as number) / cnt);
        }
      }
      shift += Math.sqrt(sqDist(center, centers[c] as ReadonlyArray<number>));
      newCenters.push(center);
    }
    centers = newCenters;
    if (changed === 0 || shift < tol) {
      converged = true;
      break;
    }
  }
  return {
    method: 'kmeans',
    labels,
    nClusters: k,
    centroids: centers,
    iterations: iter + 1,
    converged,
  };
}

/** Average silhouette coefficient — quality metric for any clustering. */
export function silhouetteScore(
  X: ReadonlyArray<ReadonlyArray<number>>,
  labels: ReadonlyArray<number>,
): number {
  const n = X.length;
  if (n !== labels.length) {
    throw new Error('silhouetteScore: X and labels must align');
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const lab = labels[i] as number;
    if (lab < 0) continue;  // skip DBSCAN noise points
    let arr = clusters.get(lab);
    if (arr === undefined) {
      arr = [];
      clusters.set(lab, arr);
    }
    arr.push(i);
  }
  if (clusters.size < 2) return 0;
  let sumS = 0;
  let counted = 0;
  for (let i = 0; i < n; i += 1) {
    const lab = labels[i] as number;
    if (lab < 0) continue;
    const own = clusters.get(lab) as number[];
    if (own.length < 2) {
      counted += 1;
      continue;
    }
    let a = 0;
    for (const j of own) {
      if (j === i) continue;
      a += Math.sqrt(
        sqDist(
          X[i] as ReadonlyArray<number>,
          X[j] as ReadonlyArray<number>,
        ),
      );
    }
    a /= own.length - 1;
    let bMin = Number.POSITIVE_INFINITY;
    for (const [otherLab, idxs] of clusters.entries()) {
      if (otherLab === lab) continue;
      let dSum = 0;
      for (const j of idxs) {
        dSum += Math.sqrt(
          sqDist(
            X[i] as ReadonlyArray<number>,
            X[j] as ReadonlyArray<number>,
          ),
        );
      }
      const dAvg = dSum / idxs.length;
      if (dAvg < bMin) bMin = dAvg;
    }
    const s = (bMin - a) / Math.max(a, bMin);
    sumS += s;
    counted += 1;
  }
  return counted === 0 ? 0 : sumS / counted;
}
