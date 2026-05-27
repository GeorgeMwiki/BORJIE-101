/**
 * Sample quantile using R's "type 7" linear-interpolation method
 * (the same default jStat and simple-statistics use).
 *
 *   h = (n − 1) p
 *   x_(⌊h⌋ + 1) + (h − ⌊h⌋) * (x_(⌊h⌋ + 2) − x_(⌊h⌋ + 1))
 *
 * p ∈ [0, 1]. p = 0 returns min, p = 1 returns max.
 */

export function quantile(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) {
    throw new Error('quantile: cannot compute quantile of empty vector');
  }
  if (p < 0 || p > 1 || Number.isNaN(p)) {
    throw new Error(`quantile: p must be in [0, 1]; got ${p}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) {
    return sorted[0] as number;
  }
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;
  const xlo = sorted[lo] as number;
  const xhi = sorted[hi] as number;
  return xlo + frac * (xhi - xlo);
}
