/**
 * Stratified sampling — partition by stratum key, take a proportional
 * sample from each stratum using SRS-without-replacement.
 */

import { simpleRandomSample } from './srs.js';

export interface Stratum {
  readonly key: string;
  readonly proportion?: number;
}

export function stratifiedSample<T>(
  population: ReadonlyArray<T>,
  stratumOf: (t: T) => string,
  totalSize: number,
  seed?: number,
): ReadonlyArray<T> {
  const buckets = new Map<string, T[]>();
  for (const t of population) {
    const k = stratumOf(t);
    let arr = buckets.get(k);
    if (arr === undefined) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(t);
  }
  const out: T[] = [];
  let i = 0;
  for (const [, arr] of buckets.entries()) {
    const share = Math.max(1, Math.round((arr.length / population.length) * totalSize));
    const localSeed = seed === undefined ? undefined : seed + i;
    out.push(
      ...(simpleRandomSample(arr, Math.min(share, arr.length), localSeed) as T[]),
    );
    i += 1;
  }
  return out;
}
