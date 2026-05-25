/**
 * Property-based tests for time-series helpers in `util/series.ts` —
 * LITFIN parity audit gap #9.
 *
 * `series.ts` is pure (no I/O, no random) and feeds every downstream
 * forecaster + the backtesting harness. A subtle regression in `mean`,
 * `stdDev`, `median`, `lagDifference`, `advanceTimestamp`, or
 * `buildForecastIntervals` would silently corrupt every forecast.
 *
 * Properties exercised (100 iterations each):
 *   1. mean is invariant to permutation
 *   2. mean of [a, a, …, a] (n times) === a
 *   3. mean of [x] === x
 *   4. median is invariant to permutation
 *   5. median of a sorted ascending series === middle element
 *   6. stdDev of [a, a, …, a] === 0
 *   7. stdDev is invariant to permutation
 *   8. lagDifference(xs, 1) has length xs.length - 1
 *   9. lagDifference + cumulative sum recovers original delta sequence
 *   10. advanceTimestamp(t, n) then advanceTimestamp(result, -n) === t
 *   11. frequencyToMinutes is strictly positive
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mean,
  median,
  stdDev,
  lagDifference,
  advanceTimestamp,
  frequencyToMinutes,
  values,
  futureTimestamps,
} from '../util/series.js';
import type { TimeSeries, TimeSeriesFrequency } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────

const arbFiniteNumber = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const arbNonEmptyArray = fc.array(arbFiniteNumber, { minLength: 1, maxLength: 200 });
const arbTwoPlusArray = fc.array(arbFiniteNumber, { minLength: 2, maxLength: 200 });

const arbFrequency: fc.Arbitrary<TimeSeriesFrequency> = fc.constantFrom(
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
);

const arbIsoTimestamp = fc
  .integer({ min: 0, max: 4_000_000_000_000 }) // 0 .. ~year 2096
  .map((ms) => new Date(ms).toISOString());

function permute<T>(xs: ReadonlyArray<T>, seed: number): T[] {
  const out = [...xs];
  // Fisher-Yates with a seeded LCG so the permutation is deterministic
  // per property iteration but varies across runs.
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────

describe('series.ts — property invariants (fast-check, LITFIN parity #9)', () => {
  it('mean is invariant to permutation (within FP tolerance)', () => {
    fc.assert(
      fc.property(arbNonEmptyArray, fc.integer(), (xs, seed) => {
        const m1 = mean(xs);
        const m2 = mean(permute(xs, seed));
        // FP-sum reordering tolerated within 1e-6 of magnitude
        const tol = Math.max(1e-9, Math.abs(m1) * 1e-9);
        return Math.abs(m1 - m2) <= tol;
      }),
      { numRuns: 100 },
    );
  });

  it('mean of a constant sequence is the constant', () => {
    fc.assert(
      fc.property(
        arbFiniteNumber,
        fc.integer({ min: 1, max: 100 }),
        (value, n) => {
          const xs = Array.from({ length: n }, () => value);
          // FP summation drift scales with |value| × n. Use a magnitude-
          // and length-aware tolerance: relative epsilon × max(1, |value|).
          const tol = Math.max(1e-9, Math.abs(value) * Number.EPSILON * n * 4);
          return Math.abs(mean(xs) - value) <= tol;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mean of a single element is that element', () => {
    fc.assert(
      fc.property(arbFiniteNumber, (value) => mean([value]) === value),
      { numRuns: 100 },
    );
  });

  it('median is invariant to permutation', () => {
    fc.assert(
      fc.property(arbNonEmptyArray, fc.integer(), (xs, seed) => {
        return median(xs) === median(permute(xs, seed));
      }),
      { numRuns: 100 },
    );
  });

  it('median of an odd-length sorted ascending series is the middle element', () => {
    fc.assert(
      fc.property(
        fc.array(arbFiniteNumber, { minLength: 1, maxLength: 99 })
          .map((xs) => [...xs].sort((a, b) => a - b))
          .filter((xs) => xs.length % 2 === 1),
        (sorted) => {
          const mid = Math.floor(sorted.length / 2);
          return median(sorted) === sorted[mid];
        },
      ),
      { numRuns: 100 },
    );
  });

  it('stdDev of a constant sequence is 0', () => {
    fc.assert(
      fc.property(
        arbFiniteNumber,
        fc.integer({ min: 2, max: 100 }),
        (value, n) => {
          const xs = Array.from({ length: n }, () => value);
          // FP cancellation: sum of squared deviations near zero can leak
          // a tiny non-zero stdDev for large |value|. Tolerance scales
          // with |value| × √n × EPSILON.
          const tol = Math.max(1e-9, Math.abs(value) * Math.sqrt(n) * Number.EPSILON * 8);
          return Math.abs(stdDev(xs)) <= tol;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('stdDev returns 0 for sequences of length < 2 (by contract)', () => {
    fc.assert(
      fc.property(arbFiniteNumber, (v) => stdDev([v]) === 0),
      { numRuns: 100 },
    );
  });

  it('lagDifference produces an array of length n - k', () => {
    fc.assert(
      fc.property(
        arbTwoPlusArray,
        fc.integer({ min: 1, max: 10 }),
        (xs, k) => {
          const out = lagDifference(xs, k);
          if (xs.length <= k) return out.length === 0;
          return out.length === xs.length - k;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lagDifference at k=1 sums to xs[last] - xs[0]', () => {
    fc.assert(
      fc.property(arbTwoPlusArray, (xs) => {
        const diffs = lagDifference(xs, 1);
        const sum = diffs.reduce((a, b) => a + b, 0);
        const expected = xs[xs.length - 1]! - xs[0]!;
        // Tolerance for floating-point summation drift
        const tol = Math.max(1e-6, Math.abs(expected) * 1e-9);
        return Math.abs(sum - expected) <= tol;
      }),
      { numRuns: 100 },
    );
  });

  it('advanceTimestamp(t, n, f) then advanceTimestamp(result, -n, f) === t', () => {
    fc.assert(
      fc.property(
        arbIsoTimestamp,
        fc.integer({ min: 1, max: 1000 }),
        arbFrequency,
        (t, n, f) => {
          const forward = advanceTimestamp(t, n, f);
          const back = advanceTimestamp(forward, -n, f);
          // Original t may have been normalised by Date — compare via parse.
          return Date.parse(back) === Date.parse(t);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('frequencyToMinutes is always strictly positive', () => {
    fc.assert(
      fc.property(arbFrequency, (f) => frequencyToMinutes(f) > 0),
      { numRuns: 50 },
    );
  });

  it('values(series) length equals series.points.length', () => {
    const arbSeries: fc.Arbitrary<TimeSeries> = fc.tuple(
      fc.string({ minLength: 1, maxLength: 16 }),
      arbFrequency,
      fc.array(fc.tuple(arbIsoTimestamp, arbFiniteNumber), { minLength: 0, maxLength: 50 }),
    ).map(([id, frequency, raw]) => {
      // Sort raw by timestamp ascending so assertValidSeries-style consumers
      // wouldn't trip (these tests don't assert that, but it makes the
      // series shape canonical).
      const points = [...raw]
        .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
        .map(([t, y]) => ({ t, y }));
      return Object.freeze({ id, frequency, points });
    });
    fc.assert(
      fc.property(arbSeries, (s) => values(s).length === s.points.length),
      { numRuns: 50 },
    );
  });

  it('futureTimestamps produces exactly `steps` ISO-formatted strings', () => {
    const arbSeries: fc.Arbitrary<TimeSeries> = fc.tuple(
      fc.string({ minLength: 1, maxLength: 16 }),
      arbFrequency,
      arbIsoTimestamp,
      arbFiniteNumber,
    ).map(([id, frequency, t, y]) => Object.freeze({
      id,
      frequency,
      points: [{ t, y }],
    }));
    fc.assert(
      fc.property(arbSeries, fc.integer({ min: 1, max: 30 }), (s, steps) => {
        const out = futureTimestamps(s, steps);
        return out.length === steps && out.every((iso) => Number.isFinite(Date.parse(iso)));
      }),
      { numRuns: 50 },
    );
  });
});
