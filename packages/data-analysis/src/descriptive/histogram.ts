/**
 * Histogram with equal-width bins. Returns bin edges and counts.
 *
 * Default bin count uses the Sturges rule: k = ⌈log2(n) + 1⌉ — adequate
 * for the small-to-medium vectors Mr. Mwikila feeds us.
 */

export interface HistogramResult {
  readonly bins: ReadonlyArray<number>;     // edges, length k + 1
  readonly counts: ReadonlyArray<number>;   // length k
  readonly k: number;                       // number of bins
}

export function histogram(
  values: ReadonlyArray<number>,
  binsOverride?: number,
): HistogramResult {
  if (values.length === 0) {
    throw new Error('histogram: cannot compute histogram of empty vector');
  }
  let lo = values[0] as number;
  let hi = values[0] as number;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;
  const k =
    binsOverride !== undefined && binsOverride > 0
      ? Math.floor(binsOverride)
      : Math.max(1, Math.ceil(Math.log2(values.length) + 1));
  const width = range === 0 ? 1 : range / k;
  const edges: number[] = [];
  for (let i = 0; i <= k; i += 1) {
    edges.push(lo + i * width);
  }
  // Force the final edge exact to handle floating drift on the upper bound.
  edges[k] = hi;
  const counts = new Array<number>(k).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx >= k) idx = k - 1;
    if (idx < 0) idx = 0;
    counts[idx] = (counts[idx] as number) + 1;
  }
  return { bins: edges, counts, k };
}
