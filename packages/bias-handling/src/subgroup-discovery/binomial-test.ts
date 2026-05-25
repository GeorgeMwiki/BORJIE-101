/**
 * Two-sided binomial p-value via a normal approximation.
 *
 * For a slice of size n with k failures, tests whether the
 * slice's error rate could plausibly come from the global error
 * rate p. We approximate the binomial distribution with a
 * normal Z statistic — adequate for n*p > 5 (which we filter on
 * via `minSliceSize` in the caller).
 *
 * For very small slices we fall back to a conservative 1.0
 * p-value (i.e. "not significant") rather than emitting a
 * misleading number.
 */

/** Standard normal CDF via Abramowitz & Stegun 26.2.17. */
function normalCdf(z: number): number {
  // numerical-recipes style erf approximation
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-sided p-value that k / n differs from p.
 *
 * `minN` controls the small-sample fallback (default 10). Below
 * that, returns 1.0.
 */
export function twoSidedBinomialPValue(args: {
  observedFailures: number;
  n: number;
  baselineRate: number;
  minN?: number;
}): number {
  const minN = args.minN ?? 10;
  if (args.n < minN) return 1.0;
  if (args.baselineRate <= 0 || args.baselineRate >= 1) return 1.0;
  const mean = args.n * args.baselineRate;
  const variance = args.n * args.baselineRate * (1 - args.baselineRate);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 1.0;
  const z = (args.observedFailures - mean) / sd;
  const oneTail = 1 - normalCdf(Math.abs(z));
  // two-sided
  const p = 2 * oneTail;
  return Math.max(0, Math.min(1, p));
}
