/**
 * Kendall's tau-b rank correlation (with tie adjustment).
 *
 *   τ_b = (C − D) / √((n0 − n1)(n0 − n2))
 *
 * where n0 = n(n−1)/2, n1 = Σ t(t−1)/2 for ties in x, n2 likewise for y.
 *
 * Reference: Kendall, M. G. (1938). *A new measure of rank correlation.*
 * Biometrika 30(1/2):81-93. URL: <https://doi.org/10.2307/2332226>.
 * Date checked: 2026-05-27.
 */

export function kendall(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
): number {
  if (x.length !== y.length) {
    throw new Error('kendall: x and y must have equal length');
  }
  const n = x.length;
  if (n < 2) throw new Error('kendall: need n ≥ 2');
  let concordant = 0;
  let discordant = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = (x[i] as number) - (x[j] as number);
      const dy = (y[i] as number) - (y[j] as number);
      const sign = Math.sign(dx) * Math.sign(dy);
      if (sign > 0) concordant += 1;
      else if (sign < 0) discordant += 1;
      else {
        if (dx === 0) tx += 1;
        if (dy === 0) ty += 1;
      }
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt((n0 - tx) * (n0 - ty));
  if (denom === 0) return 0;
  return (concordant - discordant) / denom;
}
