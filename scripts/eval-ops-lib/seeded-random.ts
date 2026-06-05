/**
 * Deterministic, dependency-free PRNG for eval-ops runners (LP-22a).
 *
 * mulberry32 — a tiny, well-distributed 32-bit generator. Given the same
 * seed it produces the exact same stream, so capability/SOTA runs are
 * reproducible in CI and a report diff is meaningful (no flakiness from
 * `Math.random`).
 *
 * @module eval-ops-lib/seeded-random
 */

export interface SeededRandom {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Bernoulli draw — true with probability `p`. */
  bool(p: number): boolean;
  /** Sample one element of a non-empty array. */
  pick<T>(items: ReadonlyArray<T>): T;
}

/** Build a {@link SeededRandom} from a 32-bit seed. */
export function createSeededRandom(seed: number): SeededRandom {
  // Force to a 32-bit unsigned int so callers can pass any integer.
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (max < min) throw new Error('int(min,max): max < min');
      return min + Math.floor(next() * (max - min + 1));
    },
    bool(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick: empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}
