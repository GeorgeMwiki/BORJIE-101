/**
 * Deterministic RNG — Mulberry32. Same seed → same stream.
 */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleNormal(rng: () => number): number {
  // Box-Muller. Returns a single sample, discards the second.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function samplePoisson(rng: () => number, lambda: number): number {
  // Knuth method for small lambda; for large lambda, transformed
  // rejection (Atkinson). Cap at 200 for safety.
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rng();
    } while (p > L && k < 200);
    return k - 1;
  }
  // Normal approximation
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * sampleNormal(rng)));
}
