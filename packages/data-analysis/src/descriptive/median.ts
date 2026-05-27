/**
 * Sample median (50th percentile via linear interpolation).
 * Input is never mutated — we copy before sorting.
 */

export function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    throw new Error('median: cannot compute median of empty vector');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
