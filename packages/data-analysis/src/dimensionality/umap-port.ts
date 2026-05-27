/**
 * UMAP-lite — a *port* of the neighbour-graph + force-directed layout
 * stage of UMAP, **not** a full implementation. The full UMAP requires
 * Riemannian-manifold preserving fuzzy simplicial sets and a stochastic
 * gradient descent over the cross-entropy loss, which is out of scope
 * for a 2026 floor. This port:
 *
 *   1. Builds a k-nearest-neighbour graph in the input space.
 *   2. Initialises a 2-D embedding from the first two PCs.
 *   3. Runs T iterations of an attractive/repulsive force-directed
 *      layout where neighbours pull and non-neighbours push.
 *
 * It is enough for the "show me a 2-D scatter of buyer cohorts"
 * narrative; for academic UMAP, swap in `umap-js` at the composition
 * root.
 *
 * Reference: McInnes, L., Healy, J. & Melville, J. (2018). *UMAP:
 * Uniform Manifold Approximation and Projection for Dimension
 * Reduction.* arXiv:1802.03426. URL: <https://arxiv.org/abs/1802.03426>.
 * Date checked: 2026-05-27.
 */

import { pca } from './pca.js';
import { mulberry32, type Prng } from '../util/rng.js';

export interface UmapOptions {
  readonly nNeighbors?: number;
  readonly nIter?: number;
  readonly learningRate?: number;
  readonly seed?: number;
}

function sqDist(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return s;
}

function knnIndices(
  X: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
): number[][] {
  const n = X.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const dists: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      dists.push({
        j,
        d: sqDist(X[i] as ReadonlyArray<number>, X[j] as ReadonlyArray<number>),
      });
    }
    dists.sort((a, b) => a.d - b.d);
    out.push(dists.slice(0, k).map((e) => e.j));
  }
  return out;
}

export function umapLite(
  X: ReadonlyArray<ReadonlyArray<number>>,
  opts: UmapOptions = {},
): number[][] {
  const n = X.length;
  if (n < 3) throw new Error('umapLite: need n ≥ 3');
  const k = opts.nNeighbors ?? Math.min(15, n - 1);
  const iters = opts.nIter ?? 200;
  const lr = opts.learningRate ?? 0.1;
  const rng: Prng = mulberry32(opts.seed);
  // Initialise from PCA top-2.
  const init = pca(X, 2);
  const Y: number[][] = init.transformed.map((row) => [...row]);
  const neighbours = knnIndices(X, k);
  for (let t = 0; t < iters; t += 1) {
    const alpha = lr * (1 - t / iters);
    // For each point, attractive update for neighbours, repulsive for k random.
    for (let i = 0; i < n; i += 1) {
      const ni = neighbours[i] as number[];
      // Attractive
      for (const j of ni) {
        const yi = Y[i] as number[];
        const yj = Y[j] as number[];
        const dx = (yi[0] as number) - (yj[0] as number);
        const dy = (yi[1] as number) - (yj[1] as number);
        const d2 = dx * dx + dy * dy;
        const grad = -2 / (1 + d2);
        yi[0] = (yi[0] as number) + alpha * grad * dx;
        yi[1] = (yi[1] as number) + alpha * grad * dy;
        yj[0] = (yj[0] as number) - alpha * grad * dx;
        yj[1] = (yj[1] as number) - alpha * grad * dy;
      }
      // Repulsive (negative sampling)
      for (let s = 0; s < 5; s += 1) {
        const r = Math.floor(rng() * n);
        if (r === i) continue;
        const yi = Y[i] as number[];
        const yr = Y[r] as number[];
        const dx = (yi[0] as number) - (yr[0] as number);
        const dy = (yi[1] as number) - (yr[1] as number);
        const d2 = dx * dx + dy * dy + 1e-6;
        const grad = 2 / ((0.001 + d2) * (1 + d2));
        yi[0] = (yi[0] as number) + alpha * grad * dx;
        yi[1] = (yi[1] as number) + alpha * grad * dy;
      }
    }
  }
  return Y;
}
