/**
 * Deterministic, seedable PRNG for tests.
 *
 * Implements **mulberry32** — a 32-bit-state PRNG with good
 * distributional properties for our use case (planting outliers in
 * synthetic series for detector validation). Same seed always
 * produces the same stream; no test ever depends on `Math.random`.
 *
 * Source: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */

export interface SeededRng {
  /** Next uniform sample in [0, 1). */
  readonly next: () => number;
  /** Next sample from N(mu, sigma) via Box-Muller. */
  readonly nextGaussian: (mu: number, sigma: number) => number;
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function nextGaussian(mu: number, sigma: number): number {
    // Box-Muller, draw two uniforms and emit one normal.
    const u1 = Math.max(next(), 1e-12);
    const u2 = next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  }
  return { next, nextGaussian };
}
