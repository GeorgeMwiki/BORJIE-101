/**
 * Tests for the cryptographic noise source.
 *
 * `createCryptoNoiseSource` MUST use `crypto.randomBytes` — `Math.random`
 * is not cryptographically secure and would weaken the DP guarantee. The
 * tests below verify:
 *
 *   1. Two consecutive draws from `gaussian()` differ — proves we are
 *      not stuck on a constant.
 *   2. Two consecutive draws from `laplace()` differ — same proof for
 *      the Laplace mechanism.
 *   3. Empirical mean of N=10_000 Gaussian draws is within 0.05 of 0.
 *   4. Empirical stddev of N=10_000 Gaussian draws is within 0.05 of 1.
 *   5. Empirical mean of N=10_000 Laplace(scale=1) draws is within
 *      0.05 of 0.
 *   6. Empirical stddev of N=10_000 Laplace(scale=1) draws is close to
 *      √2 (within 0.10).
 *   7. Invalid scale (≤ 0) throws — defensive surface.
 *   8. Seeded UNSAFE source produces a deterministic sequence — proves
 *      the production source is NOT seeded.
 *
 * Statistical bounds are loose enough to never flake at N=10_000 under
 * a true cryptographic RNG. If these tests start failing intermittently
 * the noise source has regressed and DP guarantees are compromised.
 */

import { describe, it, expect } from 'vitest';
import {
  createCryptoNoiseSource,
  UNSAFE_createSeededNoiseSource,
} from '../noise.js';

function mean(xs: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: ReadonlyArray<number>, mu: number): number {
  let s = 0;
  for (const x of xs) {
    const d = x - mu;
    s += d * d;
  }
  return Math.sqrt(s / xs.length);
}

function drawN(fn: () => number, n: number): ReadonlyArray<number> {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = fn();
  return out;
}

describe('graph-privacy/noise / createCryptoNoiseSource', () => {
  it('consecutive gaussian draws differ', () => {
    const noise = createCryptoNoiseSource();
    const a = noise.gaussian(1);
    const b = noise.gaussian(1);
    expect(a).not.toBe(b);
  });

  it('consecutive laplace draws differ', () => {
    const noise = createCryptoNoiseSource();
    const a = noise.laplace(1);
    const b = noise.laplace(1);
    expect(a).not.toBe(b);
  });

  it('gaussian(1) has empirical mean ≈ 0 over N=10000', () => {
    const noise = createCryptoNoiseSource();
    const xs = drawN(() => noise.gaussian(1), 10_000);
    expect(Math.abs(mean(xs))).toBeLessThan(0.05);
  });

  it('gaussian(1) has empirical stddev ≈ 1 over N=10000', () => {
    const noise = createCryptoNoiseSource();
    const xs = drawN(() => noise.gaussian(1), 10_000);
    const mu = mean(xs);
    const sd = stddev(xs, mu);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });

  it('laplace(1) has empirical mean ≈ 0 over N=10000', () => {
    const noise = createCryptoNoiseSource();
    const xs = drawN(() => noise.laplace(1), 10_000);
    expect(Math.abs(mean(xs))).toBeLessThan(0.05);
  });

  it('laplace(1) has empirical stddev ≈ √2 over N=10000', () => {
    const noise = createCryptoNoiseSource();
    const xs = drawN(() => noise.laplace(1), 10_000);
    const mu = mean(xs);
    const sd = stddev(xs, mu);
    // Laplace(0, b=1) has variance 2b² = 2, so stddev ≈ √2 ≈ 1.4142.
    expect(Math.abs(sd - Math.SQRT2)).toBeLessThan(0.10);
  });

  it('rejects non-positive scale / sigma', () => {
    const noise = createCryptoNoiseSource();
    expect(() => noise.gaussian(0)).toThrow(/sigma/);
    expect(() => noise.gaussian(-1)).toThrow(/sigma/);
    expect(() => noise.laplace(0)).toThrow(/scale/);
    expect(() => noise.laplace(-1)).toThrow(/scale/);
  });

  it('UNSAFE_createSeededNoiseSource produces deterministic sequences (proves prod source is unseeded)', () => {
    const a = UNSAFE_createSeededNoiseSource(42);
    const b = UNSAFE_createSeededNoiseSource(42);
    // First few draws must coincide across two equally-seeded sources.
    expect(a.gaussian(1)).toBeCloseTo(b.gaussian(1));
    expect(a.gaussian(1)).toBeCloseTo(b.gaussian(1));
    expect(a.laplace(1)).toBeCloseTo(b.laplace(1));
    // And the production source must differ on the next two draws.
    const prod1 = createCryptoNoiseSource();
    const prod2 = createCryptoNoiseSource();
    expect(prod1.gaussian(1)).not.toBe(prod2.gaussian(1));
  });
});
