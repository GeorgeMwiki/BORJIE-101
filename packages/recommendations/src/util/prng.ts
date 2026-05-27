/**
 * Mulberry32 PRNG — fast, deterministic, 32-bit state.
 *
 * Used by every stochastic algorithm in this package (matrix
 * factorization initialization, Thompson Sampling Beta draws, MMR
 * tie-breaks) so a fixed seed produces a byte-identical run. The
 * Gaussian draw uses Box-Muller and caches the second sample so two
 * back-to-back `nextGaussian()` calls cost one uniform pair.
 *
 * Source: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */

export interface PRNG {
  /** Uniform draw in [0, 1). */
  next(): number;
  /** Standard normal draw via Box-Muller. */
  nextGaussian(): number;
}

export function createPRNG(seed: number): PRNG {
  let state = seed >>> 0;
  if (state === 0) state = 0x1a2b3c4d;
  let cachedGaussian: number | null = null;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextGaussian(): number {
    if (cachedGaussian !== null) {
      const v = cachedGaussian;
      cachedGaussian = null;
      return v;
    }
    let u1 = next();
    while (u1 === 0) u1 = next();
    const u2 = next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cachedGaussian = r * Math.sin(theta);
    return r * Math.cos(theta);
  }

  return { next, nextGaussian };
}
