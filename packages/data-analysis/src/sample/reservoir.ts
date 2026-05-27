/**
 * Reservoir sampling (Algorithm R, Vitter 1985) — uniform random sample
 * of size k from a stream of unknown length.
 *
 * Reference: Vitter, J. S. (1985). *Random sampling with a reservoir.*
 * ACM Transactions on Mathematical Software 11(1):37-57.
 * URL: <https://doi.org/10.1145/3147.3165>. Date checked: 2026-05-27.
 */

import { mulberry32, type Prng } from '../util/rng.js';

export function reservoirSample<T>(
  stream: Iterable<T>,
  k: number,
  seed?: number,
): ReadonlyArray<T> {
  if (k <= 0) throw new Error('reservoirSample: k must be ≥ 1');
  const rng: Prng = mulberry32(seed);
  const out: T[] = [];
  let i = 0;
  for (const item of stream) {
    if (i < k) {
      out.push(item);
    } else {
      const j = Math.floor(rng() * (i + 1));
      if (j < k) out[j] = item;
    }
    i += 1;
  }
  return out;
}
