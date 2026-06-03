/**
 * Correlation-detector tests (LP-18). Verifies the pure Pearson + p-value math
 * and the nightly pass gating (|r|>0.4, p<0.05, n>=30) over the co-observed
 * belief series that each outcome row carries.
 */

import { describe, it, expect } from 'vitest';

import {
  pearson,
  findCorrelations,
  DEFAULT_MIN_SAMPLE,
  type OutcomeRow,
} from '../correlation-detector.js';
import { createInMemoryBeliefStore } from '../belief-store.js';
import type { Belief } from '../types.js';

describe('pearson', () => {
  it('returns r=1 for a perfectly correlated series', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [2, 4, 6, 8, 10, 12, 14, 16];
    const { r, p } = pearson(xs, ys);
    expect(r).toBeCloseTo(1, 5);
    expect(p).toBeLessThan(0.05);
  });

  it('returns r≈0 for an uncorrelated series', () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = [5, 1, 6, 2, 4, 3];
    const { r } = pearson(xs, ys);
    expect(Math.abs(r)).toBeLessThan(0.6);
  });

  it('returns p=1 for n < 3', () => {
    expect(pearson([1, 2], [1, 2]).p).toBe(1);
  });

  it('returns r=0,p=1 for a constant series (zero variance)', () => {
    const { r, p } = pearson([1, 1, 1, 1], [1, 2, 3, 4]);
    expect(r).toBe(0);
    expect(p).toBe(1);
  });
});

describe('findCorrelations', () => {
  const numericBelief: Belief = {
    id: 'b-1',
    domain: 'sector-economics',
    subject: 'geita-recovery-rate',
    description: 'Recovery rate',
    value: { kind: 'scalar', scalar: 0.9 },
    confidence: 0.7,
    sources: [],
    revisedAt: '2026-05-30T00:00:00.000Z',
    revisionCount: 1,
    tags: [],
    subjectUserId: null,
    subjectOrgId: null,
  };

  it('returns [] when there are no numeric beliefs', async () => {
    const store = createInMemoryBeliefStore([
      { ...numericBelief, value: { kind: 'text', text: 'qualitative' } },
    ]);
    const out = await findCorrelations(
      {},
      { store, outcomeFetcher: async () => correlatedOutcomes(40) },
    );
    expect(out).toEqual([]);
  });

  it('returns [] when there are no outcomes', async () => {
    const store = createInMemoryBeliefStore([numericBelief]);
    const out = await findCorrelations(
      {},
      { store, outcomeFetcher: async () => [] },
    );
    expect(out).toEqual([]);
  });

  it('skips cells below the minimum sample size', async () => {
    const store = createInMemoryBeliefStore([numericBelief]);
    const out = await findCorrelations(
      {},
      { store, outcomeFetcher: async () => correlatedOutcomes(DEFAULT_MIN_SAMPLE - 1) },
    );
    expect(out).toEqual([]);
  });

  it('drops rows that carry no co-observed belief value (no constant broadcast)', async () => {
    const store = createInMemoryBeliefStore([numericBelief]);
    // Outcomes vary but never carry a beliefValue → no aligned pairs → no
    // finding (this is the bug-regression guard: the old code broadcast the
    // belief central value as a constant and could never produce a finding,
    // now an unattributed-without-beliefValue row simply contributes nothing).
    const out = await findCorrelations(
      {},
      {
        store,
        outcomeFetcher: async () =>
          Array.from({ length: 40 }, (_, i) => ({
            sector: 'gold',
            region: 'geita',
            metric: 'throughput',
            value: i % 7,
          })),
      },
    );
    expect(out).toEqual([]);
  });

  it('DETECTS a real belief×outcome correlation (|r|>0.4, p<0.05)', async () => {
    const store = createInMemoryBeliefStore([numericBelief]);
    const out = await findCorrelations(
      {},
      { store, outcomeFetcher: async () => correlatedOutcomes(40) },
    );
    expect(out.length).toBe(1);
    const finding = out[0];
    expect(finding.beliefSubject).toBe('geita-recovery-rate');
    expect(finding.outcomeMetric).toBe('throughput');
    expect(Math.abs(finding.r)).toBeGreaterThan(0.4);
    expect(finding.p).toBeLessThan(0.05);
    expect(finding.n).toBe(40);
  });

  it('attributes a row only to its named belief subject', async () => {
    const other: Belief = { ...numericBelief, id: 'b-2', subject: 'mwanza-ore-grade' };
    const store = createInMemoryBeliefStore([numericBelief, other]);
    // All rows are attributed to geita-recovery-rate, so only that belief
    // should yield a finding; mwanza-ore-grade gets zero aligned pairs.
    const out = await findCorrelations(
      {},
      { store, outcomeFetcher: async () => correlatedOutcomes(40, 'geita-recovery-rate') },
    );
    expect(out.length).toBe(1);
    expect(out[0].beliefSubject).toBe('geita-recovery-rate');
  });
});

/**
 * Build outcomes whose co-observed belief value rises with the outcome value
 * (a genuine positive correlation), plus a little deterministic wobble so the
 * series is not a degenerate straight line.
 */
function correlatedOutcomes(n: number, beliefSubject?: string): OutcomeRow[] {
  return Array.from({ length: n }, (_, i) => {
    const beliefValue = 0.5 + i * 0.01;
    const wobble = i % 3 === 0 ? 0.4 : 0; // breaks perfect collinearity
    return {
      sector: 'gold',
      region: 'geita',
      metric: 'throughput',
      value: beliefValue * 10 + wobble,
      beliefValue,
      ...(beliefSubject ? { beliefSubject } : {}),
    };
  });
}
