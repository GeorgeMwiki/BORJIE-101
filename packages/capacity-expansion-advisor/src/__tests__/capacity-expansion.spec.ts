/**
 * Happy-path tests for the capacity-expansion advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCapacityExpansionAdvisor,
  computeNpv,
  type ExpansionAnalyzeInput,
} from '../index.js';

const SAMPLE_INPUT: ExpansionAnalyzeInput = {
  currency: 'USD',
  discountRate: 0.12,
  scenarios: [
    {
      id: 'shaft-A',
      kind: 'new-shaft',
      label: 'Sink shaft A',
      upfrontCapex: 5_000_000,
      incrementalCashflows: [1_500_000, 1_700_000, 1_900_000, 2_000_000, 2_100_000],
      incrementalTonnesPerYear: 1_200,
    },
    {
      id: 'site-B',
      kind: 'new-site',
      label: 'Open site B',
      upfrontCapex: 12_000_000,
      incrementalCashflows: [2_500_000, 3_000_000, 3_500_000, 3_800_000, 4_000_000],
      incrementalTonnesPerYear: 2_400,
    },
    {
      id: 'plant-up',
      kind: 'processing-upgrade',
      label: 'Plant upgrade',
      upfrontCapex: 2_000_000,
      incrementalCashflows: [700_000, 800_000, 900_000, 1_000_000, 1_000_000],
      incrementalTonnesPerYear: 0,
    },
  ],
};

describe('capacity-expansion-advisor.analyze', () => {
  it('ranks scenarios by NPV and returns one outcome per scenario', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const advisor = createCapacityExpansionAdvisor({ logger });
    const result = await advisor.analyze(SAMPLE_INPUT);
    expect(result.outcomes.length).toBe(SAMPLE_INPUT.scenarios.length);
    expect(result.rankedByNpv.length).toBe(SAMPLE_INPUT.scenarios.length);
    expect(result.outcomes[0]?.npv).toBeDefined();
  });

  it('NPV helper handles a known textbook case', () => {
    // 1000 invested, 600+600 returned, r=10% → NPV ≈ 41.32
    expect(computeNpv(1000, [600, 600], 0.1)).toBeCloseTo(41.32, 1);
  });
});

describe('capacity-expansion-advisor.recommend', () => {
  it('returns at least one recommendation for clearly-positive scenarios', async () => {
    const advisor = createCapacityExpansionAdvisor();
    const analysis = await advisor.analyze(SAMPLE_INPUT);
    const recs = await advisor.recommend({
      analysis,
      policy: { minNpv: 0, maxPaybackYears: 10 },
    });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]?.evidence.length).toBeGreaterThan(0);
  });
});
