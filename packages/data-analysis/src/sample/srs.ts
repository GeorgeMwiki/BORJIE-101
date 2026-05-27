/**
 * Simple random sample without replacement, via Fisher-Yates partial shuffle.
 */

import { mulberry32, type Prng } from '../util/rng.js';

export function simpleRandomSample<T>(
  population: ReadonlyArray<T>,
  size: number,
  seed?: number,
): ReadonlyArray<T> {
  if (size < 0) throw new Error('simpleRandomSample: size must be ≥ 0');
  if (size > population.length) {
    throw new Error('simpleRandomSample: size larger than population');
  }
  const rng: Prng = mulberry32(seed);
  const arr = [...population];
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr.slice(0, size);
}
