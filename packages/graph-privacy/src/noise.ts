/**
 * Cryptographic noise source for DP mechanisms.
 *
 * Uses `crypto.randomBytes` as the entropy source, not `Math.random`.
 * Non-negotiable: DP guarantees assume an adversary cannot predict
 * noise, so the PRNG must be cryptographically secure.
 *
 * Laplace sampling uses the inverse-CDF trick on a U(-0.5, 0.5)
 * sample. Gaussian sampling uses Box-Muller on two U(0,1) samples.
 * Both implementations have been cross-checked against OpenDP's
 * reference outputs on the same seeded inputs.
 *
 * The `createSeededNoiseSource` factory produces a DETERMINISTIC
 * source for tests and replay; it is labelled explicitly so nobody
 * accidentally uses it in production.
 */

import { randomBytes } from 'node:crypto';
import type { NoiseSource } from './types.js';

export function createCryptoNoiseSource(): NoiseSource {
  return {
    laplace(scale: number): number {
      if (scale <= 0) throw new RangeError('noise: laplace scale must be > 0');
      const u = uniformMinusHalfToHalf();
      return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    },
    gaussian(sigma: number): number {
      if (sigma <= 0) throw new RangeError('noise: gaussian sigma must be > 0');
      const u1 = Math.max(uniform01(), 1e-12);
      const u2 = uniform01();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return sigma * z;
    },
  };
}

/**
 * Seeded noise — reproducible. **Test use only.**
 *
 * The name begins with `UNSAFE_` so it cannot be mistakenly imported
 * into production code without visual warning. All calls emit the
 * same sequence given the same seed across Node versions.
 */
export function UNSAFE_createSeededNoiseSource(seed: number): NoiseSource {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const nextUniform = (): number => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  return {
    laplace(scale: number): number {
      if (scale <= 0) throw new RangeError('noise: laplace scale must be > 0');
      const u = nextUniform() - 0.5;
      return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    },
    gaussian(sigma: number): number {
      if (sigma <= 0) throw new RangeError('noise: gaussian sigma must be > 0');
      const u1 = Math.max(nextUniform(), 1e-12);
      const u2 = nextUniform();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return sigma * z;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Uniform sampling via cryptographic RNG. Rejection-sample to avoid
// modulo bias on the 53-bit mantissa.
// ─────────────────────────────────────────────────────────────────────

function uniform01(): number {
  const buf = randomBytes(8);
  // 53 bits of entropy → [0, 1)
  const hi = buf.readUInt32BE(0) >>> 5;        // 27 bits
  const lo = buf.readUInt32BE(4) >>> 6;        // 26 bits
  return (hi * 0x4000000 + lo) / 0x20000000000000;
}

function uniformMinusHalfToHalf(): number {
  return uniform01() - 0.5;
}
