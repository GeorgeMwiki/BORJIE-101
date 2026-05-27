/**
 * Arithmetic mean (sample mean).
 *
 * Implemented with Kahan-Babuška compensated summation so that long
 * vectors don't lose precision to running-sum drift — important for
 * the per-site throughput vectors Mr. Mwikila feeds us, which can
 * easily run 10k+ entries.
 */

export function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    throw new Error('mean: cannot compute mean of empty vector');
  }
  let sum = 0;
  let c = 0; // Kahan compensation
  for (const v of values) {
    const y = v - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum / values.length;
}
