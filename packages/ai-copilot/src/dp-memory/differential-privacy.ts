/**
 * differential-privacy.ts — primitive DP mechanisms.
 *
 * References:
 *   - Dwork, C. & Roth, A. (2014). "The Algorithmic Foundations of
 *     Differential Privacy." Foundations and Trends in Theoretical
 *     Computer Science. Specifically:
 *       § 3.3 — Laplace mechanism       (ε-DP)
 *       § 3.5 — Gaussian mechanism      ((ε, δ)-DP)
 *       § 3.5.2 — Advanced composition  (Theorem 3.20)
 *   - Dwork, Rothblum, Vadhan (2010). "Boosting and Differential
 *     Privacy." FOCS. — advanced composition bound.
 *
 * This module has zero I/O — pure numerical primitives that the higher
 * layers compose. Every public function is deterministic modulo the RNG
 * seed injected via the optional `rng` parameter; tests pin the RNG so
 * the statistical property tests are reproducible.
 */

/** Random source type — Math.random is the default. */
export type RandomSource = () => number;

/**
 * Draw a sample from the Laplace distribution with location μ=0 and
 * scale b, using inverse-CDF sampling.
 *
 * Laplace CDF: F(x) = 1/2 + 1/2 · sign(x) · (1 − exp(−|x|/b))
 * Inverse:    F⁻¹(u) = −b · sign(u − 1/2) · ln(1 − 2|u − 1/2|)  for u∈(0,1)
 *
 * We nudge u out of the {0, 1} boundary to avoid ln(0) / ln(1) blow-ups.
 */
export function sampleLaplace(scale: number, rng: RandomSource = Math.random): number {
  if (scale <= 0 || !Number.isFinite(scale)) {
    throw new Error(`Laplace scale must be a positive finite number, got ${scale}`);
  }
  // Nudge away from 0/1 — ln(0) and ln(1 - tiny) are unsafe.
  const raw = rng();
  const eps = 1e-12;
  const u = Math.min(Math.max(raw, eps), 1 - eps);
  const centred = u - 0.5;
  const sign = centred >= 0 ? 1 : -1;
  return -scale * sign * Math.log(1 - 2 * Math.abs(centred));
}

/**
 * Laplace mechanism. Releases f(x) + Lap(Δf/ε) which satisfies
 * ε-differential privacy when Δf is a correct L1 sensitivity bound.
 *
 * @param rawValue    true aggregate
 * @param sensitivity L1 sensitivity bound Δf (MUST be honest)
 * @param epsilon     privacy budget spent on this release
 */
export function addLaplaceNoise(
  rawValue: number,
  sensitivity: number,
  epsilon: number,
  rng: RandomSource = Math.random,
): number {
  if (!Number.isFinite(rawValue)) {
    throw new Error(`rawValue must be finite, got ${rawValue}`);
  }
  if (sensitivity <= 0 || !Number.isFinite(sensitivity)) {
    throw new Error(`sensitivity must be > 0, got ${sensitivity}`);
  }
  if (epsilon <= 0 || !Number.isFinite(epsilon)) {
    throw new Error(`epsilon must be > 0, got ${epsilon}`);
  }
  const scale = sensitivity / epsilon;
  return rawValue + sampleLaplace(scale, rng);
}

/**
 * Draw a sample from the standard Normal distribution via the Box-
 * Muller transform. Two uniform draws produce one normal sample.
 */
export function sampleStandardNormal(rng: RandomSource = Math.random): number {
  const eps = 1e-12;
  const u1 = Math.min(Math.max(rng(), eps), 1 - eps);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Gaussian mechanism. Releases f(x) + N(0, σ²) where
 *   σ = Δf · √(2 · ln(1.25/δ)) / ε
 * which satisfies (ε, δ)-differential privacy for Δf the L2 sensitivity
 * (Theorem A.1 of Dwork & Roth).
 */
export function addGaussianNoise(
  rawValue: number,
  sensitivity: number,
  epsilon: number,
  delta: number,
  rng: RandomSource = Math.random,
): number {
  if (!Number.isFinite(rawValue)) {
    throw new Error(`rawValue must be finite, got ${rawValue}`);
  }
  if (sensitivity <= 0 || !Number.isFinite(sensitivity)) {
    throw new Error(`sensitivity must be > 0, got ${sensitivity}`);
  }
  if (epsilon <= 0 || !Number.isFinite(epsilon)) {
    throw new Error(`epsilon must be > 0, got ${epsilon}`);
  }
  if (delta <= 0 || delta >= 1) {
    throw new Error(`delta must be in (0, 1), got ${delta}`);
  }
  const sigma = (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon;
  return rawValue + sigma * sampleStandardNormal(rng);
}

/**
 * Basic (sequential) composition. If a composite mechanism is the
 * sequential application of k mechanisms with privacy parameters
 * ε_1..ε_k, the combined mechanism is (Σ ε_i)-DP (Dwork & Roth, Thm 3.14).
 */
export function basicComposition(epsilons: readonly number[]): number {
  validateEpsilons(epsilons);
  return epsilons.reduce((sum, e) => sum + e, 0);
}

/**
 * Advanced composition (Dwork, Rothblum & Vadhan 2010; Dwork & Roth
 * Theorem 3.20). For k-fold adaptive composition of ε-DP mechanisms,
 * the composite is (ε', kδ + δ')-DP with
 *
 *   ε' = √(2k · ln(1/δ')) · ε  +  k · ε · (e^ε − 1)
 *
 * For small ε this is tighter than basic composition. When callers
 * invoke this with a non-uniform epsilon vector we conservatively use
 * max(ε_i) as the per-mechanism ε and set k = epsilons.length. A
 * tighter heterogeneous bound (Kairouz et al. 2015) can be swapped in
 * later without breaking the signature — we just need the δ' slack
 * parameter and this function already accepts it.
 */
export function advancedComposition(
  epsilons: readonly number[],
  deltaPrime: number,
): number {
  validateEpsilons(epsilons);
  if (deltaPrime <= 0 || deltaPrime >= 1) {
    throw new Error(`deltaPrime must be in (0, 1), got ${deltaPrime}`);
  }
  const k = epsilons.length;
  if (k === 0) return 0;
  const epsMax = Math.max(...epsilons);
  const term1 = Math.sqrt(2 * k * Math.log(1 / deltaPrime)) * epsMax;
  const term2 = k * epsMax * (Math.exp(epsMax) - 1);
  return term1 + term2;
}

/**
 * Laplace-tail 95% confidence interval for a released value. The
 * Laplace distribution with scale b=Δf/ε has Pr(|X| > t) = exp(−t/b),
 * so the two-sided 95% interval is ±b · ln(1/0.025) ≈ 3.6889 · b.
 *
 * Returns [lower, upper] around `releasedValue`.
 */
export function laplaceConfidenceInterval(
  releasedValue: number,
  sensitivity: number,
  epsilon: number,
  confidence = 0.95,
): readonly [number, number] {
  if (confidence <= 0 || confidence >= 1) {
    throw new Error(`confidence must be in (0, 1), got ${confidence}`);
  }
  if (sensitivity <= 0) throw new Error('sensitivity must be > 0');
  if (epsilon <= 0) throw new Error('epsilon must be > 0');
  const b = sensitivity / epsilon;
  const alpha = 1 - confidence;
  // Symmetric Laplace tails: solve exp(-t/b) = alpha/2 → t = b · ln(2/α).
  const half = b * Math.log(2 / alpha);
  return [releasedValue - half, releasedValue + half];
}

/**
 * Seedable mulberry32 PRNG — used exclusively by the statistical property
 * tests. NOT for production DP. Production paths pass `undefined` and
 * inherit `Math.random`. (A crypto-grade RNG is a future upgrade — left
 * as a port so tests can pin determinism.)
 */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateEpsilons(epsilons: readonly number[]): void {
  for (const e of epsilons) {
    if (!Number.isFinite(e) || e <= 0) {
      throw new Error(`Every epsilon must be a positive finite number, got ${e}`);
    }
  }
}
