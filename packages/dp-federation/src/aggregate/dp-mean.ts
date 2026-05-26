/**
 * DP mean with Gaussian noise.
 *
 * Given a clipped sample of values v_i ∈ [-C, C] (the caller is
 * responsible for clipping to a known sensitivity C), the DP mean is
 *
 *   mean_DP = (1/n) Σ v_i + N(0, σ² · (2C / n)²)
 *
 * where σ is the user-chosen noise scale. The Gaussian noise is
 * standard-normal scaled to the sensitivity of the *mean* (2C / n).
 *
 * Note on sensitivity: the L2 sensitivity of the mean of n bounded
 * values in [-C, C] under add/remove one is 2C / n. We follow the
 * "replace one record" sensitivity convention used by the Google DP
 * library and OpenDP. Reference:
 *   - Google DP library, mean.cc — https://github.com/google/differential-privacy
 *   - OpenDP, statistics::mean — https://opendp.org/
 *
 * The Gaussian draw uses Box-Muller via an injected RNG so tests are
 * deterministic.
 */

export class DpMeanError extends Error {
  public override readonly name = 'DpMeanError';
}

/**
 * RNG port — must return uniform on (0, 1).
 */
export interface RandomPort {
  readonly uniform: () => number;
}

export interface DpMeanParams {
  /** Clipped values; each MUST lie in [-clipBound, clipBound]. */
  readonly values: ReadonlyArray<number>;
  /** Clipping bound C used by the caller. Must be > 0. */
  readonly clipBound: number;
  /** Noise scale σ on the standard normal. Must be > 0. */
  readonly noiseSigma: number;
  readonly random: RandomPort;
}

export interface DpMeanOutcome {
  readonly mean: number;
  readonly trueMean: number;
  readonly noiseStdDev: number;
}

/**
 * Compute the DP mean with calibrated Gaussian noise.
 *
 * @param params  DpMeanParams
 * @returns       DP mean + sanity metadata (true mean kept for tests
 *                only — never leak in production).
 */
export function dpMean(params: DpMeanParams): DpMeanOutcome {
  if (!Number.isFinite(params.clipBound) || params.clipBound <= 0) {
    throw new DpMeanError(
      `clipBound must be > 0 (got ${params.clipBound})`,
    );
  }
  if (!Number.isFinite(params.noiseSigma) || params.noiseSigma <= 0) {
    throw new DpMeanError(
      `noiseSigma must be > 0 (got ${params.noiseSigma})`,
    );
  }
  if (params.values.length === 0) {
    throw new DpMeanError('values must be non-empty');
  }

  // Defensive clip-check.
  for (const v of params.values) {
    if (!Number.isFinite(v)) {
      throw new DpMeanError('values must be finite');
    }
    if (v < -params.clipBound || v > params.clipBound) {
      throw new DpMeanError(
        `value ${v} lies outside [-${params.clipBound}, ${params.clipBound}]`,
      );
    }
  }

  const n = params.values.length;
  const sum = params.values.reduce((acc, v) => acc + v, 0);
  const trueMean = sum / n;
  const sensitivity = (2 * params.clipBound) / n;
  const noiseStdDev = params.noiseSigma * sensitivity;
  const noise = gaussianStandardSample(params.random) * noiseStdDev;
  return Object.freeze({
    mean: trueMean + noise,
    trueMean,
    noiseStdDev,
  });
}

/**
 * Standard-normal draw via Box-Muller. The caller provides the
 * uniform RNG so tests are deterministic.
 */
export function gaussianStandardSample(random: RandomPort): number {
  // Box-Muller transform; rejection-free.
  let u1 = random.uniform();
  // Avoid log(0).
  if (u1 <= 0) u1 = Number.EPSILON;
  const u2 = random.uniform();
  const r = Math.sqrt(-2 * Math.log(u1));
  return r * Math.cos(2 * Math.PI * u2);
}
