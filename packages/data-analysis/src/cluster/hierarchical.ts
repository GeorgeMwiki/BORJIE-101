/**
 * Agglomerative hierarchical clustering with single / complete /
 * average linkage. Cuts the dendrogram at a target k.
 *
 * Reference: Sokal, R. R. & Sneath, P. H. A. (1963). *Principles of
 * Numerical Taxonomy.* W. H. Freeman & Co. — and the modern survey:
 * Murtagh, F. & Contreras, P. (2012). *Algorithms for hierarchical
 * clustering: an overview.* WIREs Data Mining and Knowledge Discovery
 * 2(1):86-97. URL: <https://doi.org/10.1002/widm.53>. Date checked: 2026-05-27.
 */

import type { ClusterAssignment } from '../types.js';

export type Linkage = 'single' | 'complete' | 'average';

function dist(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return Math.sqrt(s);
}

export function hierarchical(
  X: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
  linkage: Linkage = 'average',
): ClusterAssignment {
  const n = X.length;
  if (k < 1) throw new Error('hierarchical: k must be ≥ 1');
  if (k > n) throw new Error('hierarchical: k must be ≤ n');
  // Build initial pairwise distance matrix (full).
  const D: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) row.push(0);
      else if (j < i) row.push((D[j] as number[])[i] as number);
      else row.push(dist(X[i] as ReadonlyArray<number>, X[j] as ReadonlyArray<number>));
    }
    D.push(row);
  }
  // Active clusters: each cluster is the set of original indices it contains.
  const clusters: number[][] = [];
  for (let i = 0; i < n; i += 1) clusters.push([i]);
  while (clusters.length > k) {
    // Find closest pair.
    let bestI = 0;
    let bestJ = 1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        let d: number;
        if (linkage === 'single') {
          d = Number.POSITIVE_INFINITY;
          for (const a of clusters[i] as number[]) {
            for (const b of clusters[j] as number[]) {
              const v = (D[a] as number[])[b] as number;
              if (v < d) d = v;
            }
          }
        } else if (linkage === 'complete') {
          d = 0;
          for (const a of clusters[i] as number[]) {
            for (const b of clusters[j] as number[]) {
              const v = (D[a] as number[])[b] as number;
              if (v > d) d = v;
            }
          }
        } else {
          let s = 0;
          for (const a of clusters[i] as number[]) {
            for (const b of clusters[j] as number[]) {
              s += (D[a] as number[])[b] as number;
            }
          }
          d = s / ((clusters[i] as number[]).length * (clusters[j] as number[]).length);
        }
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    // Merge bestJ into bestI.
    (clusters[bestI] as number[]).push(...(clusters[bestJ] as number[]));
    clusters.splice(bestJ, 1);
  }
  // Build labels.
  const labels = new Array<number>(n).fill(0);
  for (let c = 0; c < clusters.length; c += 1) {
    for (const idx of clusters[c] as number[]) {
      labels[idx] = c;
    }
  }
  return {
    method: 'hierarchical',
    labels,
    nClusters: k,
  };
}
