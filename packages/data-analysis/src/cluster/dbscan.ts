/**
 * DBSCAN — density-based clustering.
 *
 * Labels: 0, 1, …, k − 1 for clusters; −1 for noise.
 *
 * Reference: Ester, M., Kriegel, H.-P., Sander, J. & Xu, X. (1996).
 * *A density-based algorithm for discovering clusters in large
 * spatial databases with noise.* KDD-96.
 * URL: <https://www.aaai.org/Papers/KDD/1996/KDD96-037.pdf>.
 * Date checked: 2026-05-27.
 */

import type { ClusterAssignment } from '../types.js';

function dist(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return Math.sqrt(s);
}

function regionQuery(
  X: ReadonlyArray<ReadonlyArray<number>>,
  i: number,
  eps: number,
): number[] {
  const out: number[] = [];
  const xi = X[i] as ReadonlyArray<number>;
  for (let j = 0; j < X.length; j += 1) {
    if (dist(xi, X[j] as ReadonlyArray<number>) <= eps) out.push(j);
  }
  return out;
}

export function dbscan(
  X: ReadonlyArray<ReadonlyArray<number>>,
  eps: number,
  minPts: number,
): ClusterAssignment {
  if (eps <= 0) throw new Error('dbscan: eps must be positive');
  if (minPts < 1) throw new Error('dbscan: minPts must be ≥ 1');
  const n = X.length;
  const labels = new Array<number>(n).fill(-2); // unvisited
  let clusterId = -1;
  for (let i = 0; i < n; i += 1) {
    if ((labels[i] as number) !== -2) continue;
    const neighbors = regionQuery(X, i, eps);
    if (neighbors.length < minPts) {
      labels[i] = -1; // noise (provisionally)
      continue;
    }
    clusterId += 1;
    labels[i] = clusterId;
    const seeds = [...neighbors];
    let head = 0;
    while (head < seeds.length) {
      const q = seeds[head] as number;
      head += 1;
      if ((labels[q] as number) === -1) {
        labels[q] = clusterId;
      }
      if ((labels[q] as number) !== -2) continue;
      labels[q] = clusterId;
      const qNeighbors = regionQuery(X, q, eps);
      if (qNeighbors.length >= minPts) {
        for (const r of qNeighbors) {
          if ((labels[r] as number) === -2 || (labels[r] as number) === -1) {
            seeds.push(r);
          }
        }
      }
    }
  }
  // Any remaining -2 → -1 noise (shouldn't happen but be safe)
  for (let i = 0; i < n; i += 1) {
    if ((labels[i] as number) === -2) labels[i] = -1;
  }
  return {
    method: 'dbscan',
    labels,
    nClusters: clusterId + 1,
  };
}
