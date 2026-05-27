/**
 * Sample variance (n − 1 denominator) via Welford's online algorithm.
 *
 * Welford is numerically stable in a single pass — important when the
 * input vector is large enough that the naive two-pass formula
 * accumulates catastrophic-cancellation error.
 *
 * Pass `populationDenominator = true` to use the n denominator instead.
 */

export function variance(
  values: ReadonlyArray<number>,
  populationDenominator: boolean = false,
): number {
  const n = values.length;
  if (n === 0) {
    throw new Error('variance: cannot compute variance of empty vector');
  }
  if (n === 1 && !populationDenominator) {
    throw new Error('variance: sample variance undefined for n = 1');
  }
  let m = 0;
  let m2 = 0;
  let count = 0;
  for (const v of values) {
    count += 1;
    const delta = v - m;
    m += delta / count;
    const delta2 = v - m;
    m2 += delta * delta2;
  }
  const denom = populationDenominator ? n : n - 1;
  return m2 / denom;
}
