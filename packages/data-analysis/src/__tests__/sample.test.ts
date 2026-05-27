/**
 * Sample — SRS, reservoir, bootstrap CI.
 */

import { describe as suite, it, expect } from 'vitest';
import { simpleRandomSample } from '../sample/srs.js';
import { reservoirSample } from '../sample/reservoir.js';
import { bootstrap } from '../sample/bootstrap.js';
import { mean } from '../descriptive/mean.js';

suite('sample — reference behaviour', () => {
  it('simpleRandomSample is deterministic with a seed and returns the requested size', () => {
    const pop = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = simpleRandomSample(pop, 4, 42);
    const b = simpleRandomSample(pop, 4, 42);
    expect(a).toEqual(b);
    expect(a.length).toBe(4);
    // Sample elements must come from the population
    for (const v of a) expect(pop).toContain(v);
  });

  it('reservoirSample returns k items from a stream and is deterministic with seed', () => {
    function* gen(): IterableIterator<number> {
      for (let i = 0; i < 1000; i += 1) yield i;
    }
    const r1 = reservoirSample(gen(), 10, 99);
    const r2 = reservoirSample(gen(), 10, 99);
    expect(r1).toEqual(r2);
    expect(r1.length).toBe(10);
  });

  it('bootstrap 95% CI on mean covers the true mean for uniform samples', () => {
    const sample = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ];
    const r = bootstrap(sample, mean, 2000, 0.05, 13);
    expect(r.point).toBeCloseTo(10.5, 12);
    expect(r.low).toBeLessThan(10.5);
    expect(r.high).toBeGreaterThan(10.5);
  });
});
