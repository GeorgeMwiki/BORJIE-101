/**
 * Deterministic, dependency-free PRNG for the spec-space exhaustiveness proof.
 *
 * The totality fuzz (Law 1: every schema-valid spec is safe) MUST be fully
 * reproducible: a green run today and a green run on CI six months from now have
 * to exercise the EXACT same spec space, so a regression surfaces as the same
 * failing seed rather than a heisenbug. That rules out `Math.random()` and any
 * wall-clock seeding — every bit of pseudo-randomness here is fed by a fixed
 * integer seed the caller iterates.
 *
 * `mulberry32` is a tiny, well-known 32-bit generator with a full 2^32 period
 * and good-enough distribution for structural fuzzing (we are not doing
 * cryptography — we are walking a finite spec lattice). Implemented inline so
 * the package keeps its zero-runtime-dependency posture (only zod).
 *
 * The whole module is pure: a `Prng` is a closure over a single mutable cursor
 * that is private to the closure; callers only ever see fresh return values, so
 * no shared state leaks across the generator. Re-seeding with the same integer
 * always replays the identical stream.
 *
 * @module @borjie/portal-genui/totality/prng
 */

export interface Prng {
  /** Next float in [0, 1). */
  readonly next: () => number;
  /** Integer in [min, max] inclusive. Throws when `max < min`. */
  readonly int: (min: number, max: number) => number;
  /** True with probability `p` (clamped to [0, 1]). */
  readonly bool: (p?: number) => boolean;
  /** Uniformly pick one element. Throws on an empty list. */
  readonly pick: <T>(items: ReadonlyArray<T>) => T;
}

/**
 * Construct a seeded mulberry32 generator. The same `seed` always yields the
 * same stream — no platform RNG, no clock.
 */
export function makeMulberry32(seed: number): Prng {
  if (!Number.isInteger(seed)) {
    throw new Error(`makeMulberry32: seed must be an integer, got ${seed}`);
  }
  // Cursor is forced into uint32 space; the closure is the only holder.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) {
      throw new Error(`Prng.int: max (${max}) < min (${min})`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  const bool = (p = 0.5): boolean => {
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
    return next() < clamped;
  };

  const pick = <T>(items: ReadonlyArray<T>): T => {
    if (items.length === 0) {
      throw new Error('Prng.pick: cannot pick from an empty list');
    }
    return items[int(0, items.length - 1)] as T;
  };

  return { next, int, bool, pick };
}
