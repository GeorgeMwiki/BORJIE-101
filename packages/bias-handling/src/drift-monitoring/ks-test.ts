/**
 * Two-sample Kolmogorov-Smirnov test.
 *
 * Used by `BiasDriftMonitor` to compare baseline vs current
 * window distributions of group-specific selection rates.
 *
 * Implementation: classic empirical-CDF max-gap, with the
 * asymptotic p-value via the Kolmogorov series.
 */

function ecdf(sorted: ReadonlyArray<number>, x: number): number {
  // sorted asc; returns fraction <= x
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

function ksPValue(d: number, n1: number, n2: number): number {
  // Stephens 1970 asymptotic.
  if (d <= 0) return 1;
  if (n1 === 0 || n2 === 0) return 1;
  const en = Math.sqrt((n1 * n2) / (n1 + n2));
  const lambda = (en + 0.12 + 0.11 / en) * d;
  // Q_KS(lambda) = 2 * Σ (-1)^(k-1) e^(-2 k^2 λ^2).
  let sum = 0;
  let term = 0;
  const lambdaSq = lambda * lambda;
  let fac = 2;
  let prev = 0;
  for (let k = 1; k <= 100; k++) {
    term = fac * Math.exp(-2 * k * k * lambdaSq);
    sum += term;
    if (Math.abs(term) <= 1e-10 * Math.abs(prev) || Math.abs(term) <= 1e-12) {
      return Math.max(0, Math.min(1, sum));
    }
    fac = -fac;
    prev = term;
  }
  return Math.max(0, Math.min(1, sum));
}

export function twoSampleKS(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): { d: number; pValue: number } {
  if (a.length === 0 || b.length === 0) return { d: 0, pValue: 1 };
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  // sweep over union of distinct values
  const merged = [...new Set([...sortedA, ...sortedB])].sort((x, y) => x - y);
  let dMax = 0;
  for (const x of merged) {
    const fa = ecdf(sortedA, x);
    const fb = ecdf(sortedB, x);
    const gap = Math.abs(fa - fb);
    if (gap > dMax) dMax = gap;
  }
  const p = ksPValue(dMax, sortedA.length, sortedB.length);
  return { d: dMax, pValue: p };
}
