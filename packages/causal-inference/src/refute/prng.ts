/**
 * Deterministic 32-bit PRNG — mulberry32.
 *
 * Used by refutation routines (placebo, bootstrap) so test runs are
 * fully reproducible from a seed. Pure function: returns a closure
 * that, when called, yields uniform values in [0, 1).
 *
 * @module @borjie/causal-inference/refute/prng
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}
