/**
 * Mulberry32 — a tiny, fast, seedable 32-bit PRNG with reasonable
 * statistical quality for non-cryptographic use. Determinism is the
 * point: Mr. Mwikila must be able to re-derive the same number tomorrow.
 *
 *   const rng = mulberry32(42);
 *   rng();  // [0, 1)
 *
 * Reference: Tommy Ettinger (2017), public-domain JS Mulberry32.
 */

export type Prng = () => number;

const DEFAULT_SEED = 0xc0_ff_ee_42;

export function mulberry32(seed: number = DEFAULT_SEED): Prng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard-normal samples via Box-Muller (polar variant).
 * Threaded through any deterministic `Prng`.
 */
export function gaussianPair(rng: Prng): readonly [number, number] {
  let u: number;
  let v: number;
  let s: number;
  do {
    u = 2 * rng() - 1;
    v = 2 * rng() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const f = Math.sqrt((-2 * Math.log(s)) / s);
  return [u * f, v * f] as const;
}
