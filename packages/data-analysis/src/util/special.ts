/**
 * Special functions used by distributions and inferential tests.
 *
 * All implementations are textbook — Numerical Recipes 3rd ed. and
 * Press et al. (2007). We deliberately avoid pulling in jStat as a
 * runtime dep so the package stays light. Accuracy targets:
 *
 *   - logGamma:           ≥ 10 significant figures
 *   - erf / erfInv:       ≥ 9 significant figures
 *   - regularised gamma:  ≥ 6 significant figures (sufficient for p-values)
 *   - regularised beta:   ≥ 6 significant figures
 */

/* ─────────────────────────── log-Gamma (Lanczos) ─────────────────────────── */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS: ReadonlyArray<number> = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let acc = LANCZOS_COEFFICIENTS[0] as number;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    acc += (LANCZOS_COEFFICIENTS[i] as number) / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
}

export function gamma(x: number): number {
  return Math.exp(logGamma(x));
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/* ─────────────────────────── error function ─────────────────────────── */

/**
 * Abramowitz & Stegun 7.1.26 — max error ≈ 1.5e-7. Cheap and adequate
 * for ranking p-values; if we need more we can switch to a Chebyshev
 * fit later without breaking call sites.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function erfc(x: number): number {
  return 1 - erf(x);
}

/**
 * Inverse error function — Acklam (2003) rational approximation.
 * Adequate for distribution quantile computation.
 */
export function erfInv(p: number): number {
  if (p <= -1 || p >= 1 || Number.isNaN(p)) {
    if (p === -1) return -Infinity;
    if (p === 1) return Infinity;
    return Number.NaN;
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  // p comes in as erf input → transform to standard-normal-cdf input.
  // We are computing Φ^{-1} via erfInv: erfInv(p) = Φ^{-1}((p+1)/2) / sqrt(2).
  const q = (p + 1) / 2;
  let x: number;
  const PLOW = 0.02425;
  const PHIGH = 1 - PLOW;
  if (q < PLOW) {
    const r = Math.sqrt(-2 * Math.log(q));
    x =
      (((((c[0] as number) * r + (c[1] as number)) * r + (c[2] as number)) * r +
        (c[3] as number)) *
        r +
        (c[4] as number)) *
        r +
      (c[5] as number);
    x /=
      ((((d[0] as number) * r + (d[1] as number)) * r + (d[2] as number)) * r +
        (d[3] as number)) *
        r +
      1;
  } else if (q <= PHIGH) {
    const r = q - 0.5;
    const r2 = r * r;
    x =
      (((((a[0] as number) * r2 + (a[1] as number)) * r2 + (a[2] as number)) * r2 +
        (a[3] as number)) *
        r2 +
        (a[4] as number)) *
        r2 +
      (a[5] as number);
    x *= r;
    x /=
      (((((b[0] as number) * r2 + (b[1] as number)) * r2 + (b[2] as number)) * r2 +
        (b[3] as number)) *
        r2 +
        (b[4] as number)) *
        r2 +
      1;
  } else {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    x = -(
      (((((c[0] as number) * r + (c[1] as number)) * r + (c[2] as number)) * r +
        (c[3] as number)) *
        r +
        (c[4] as number)) *
        r +
      (c[5] as number)
    );
    x /=
      ((((d[0] as number) * r + (d[1] as number)) * r + (d[2] as number)) * r +
        (d[3] as number)) *
        r +
      1;
  }
  return x / Math.SQRT2;
}

/* ─────────────────── regularised lower incomplete gamma P(a, x) ─────────────────── */

const ITMAX = 200;
const EPS = 1e-12;
const FPMIN = 1e-300;

function gammaSeries(a: number, x: number): number {
  // Series representation, good for x < a + 1
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= ITMAX; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  // Lentz's algorithm — continued fraction for the upper incomplete Γ.
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularised lower incomplete gamma P(a, x). */
export function regularisedGammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    return gammaSeries(a, x);
  }
  return 1 - gammaContinuedFraction(a, x);
}

/** Regularised upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function regularisedGammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    return 1 - gammaSeries(a, x);
  }
  return gammaContinuedFraction(a, x);
}

/* ─────────────────── regularised incomplete beta I_x(a, b) ─────────────────── */

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= ITMAX; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function regularisedIncompleteBeta(x: number, a: number, b: number): number {
  if (x < 0 || x > 1 || a <= 0 || b <= 0) return Number.NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}
