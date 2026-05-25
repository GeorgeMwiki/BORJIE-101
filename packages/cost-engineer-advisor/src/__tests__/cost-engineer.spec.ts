/**
 * Happy-path tests for the cost-engineer advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCostEngineerAdvisor,
  type CostAnalyzeInput,
} from '../index.js';

const SAMPLE_INPUT: CostAnalyzeInput = {
  currency: 'TZS',
  period: {
    periodLabel: '2026-04',
    startISO: '2026-04-01',
    endISO: '2026-04-30',
    tonnesProduced: 1000,
    tonnesSold: 950,
    averageRealisedPricePerTonne: 200_000,
  },
  opexBuckets: [
    { label: 'Labour', amount: 30_000_000, fixed: true },
    { label: 'Fuel (diesel)', amount: 60_000_000, fixed: false },
    { label: 'Consumables', amount: 15_000_000, fixed: false },
  ],
  capexAmortisationForPeriod: 10_000_000,
  cogs: {
    royaltyRate: 0.06,
    treatmentChargesPerTonne: 1_500,
  },
};

describe('cost-engineer-advisor.analyze', () => {
  it('returns a fully-populated CostAnalysis for a healthy month', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const advisor = createCostEngineerAdvisor({ logger });
    const result = await advisor.analyze(SAMPLE_INPUT);
    expect(result.pnl.revenue).toBe(950 * 200_000);
    expect(result.pnl.opexTotal).toBe(105_000_000);
    expect(result.unit.costPerTonne).toBeGreaterThan(0);
    expect(result.sensitivity.priceSensitivity.length).toBeGreaterThan(0);
    expect(logger.info).toHaveBeenCalledWith(
      'cost-engineer.analyze.start',
      expect.any(Object),
    );
  });

  it('break-even price equals the all-in-sustaining cost per tonne', async () => {
    const advisor = createCostEngineerAdvisor();
    const result = await advisor.analyze(SAMPLE_INPUT);
    expect(result.unit.breakEvenPricePerTonne).toBeCloseTo(
      result.unit.allInSustainingCostPerTonne,
      6,
    );
  });
});

describe('cost-engineer-advisor.recommend', () => {
  it('flags fuel-share blow-out with evidence references', async () => {
    const advisor = createCostEngineerAdvisor();
    const analysis = await advisor.analyze(SAMPLE_INPUT);
    const recs = await advisor.recommend({
      analysis,
      benchmarks: {
        maxFuelShareOfOpex: 0.3,
        minNetMarginPercent: -1,
      },
    });
    const fuel = recs.find((r) => r.id === 'fuel-share-high');
    expect(fuel).toBeDefined();
    expect(fuel?.evidence.length).toBeGreaterThan(0);
    expect(fuel?.evidence[0]?.kind).toBe('opex-bucket');
  });

  it('returns no recommendations when all targets satisfied', async () => {
    const advisor = createCostEngineerAdvisor();
    const analysis = await advisor.analyze({
      ...SAMPLE_INPUT,
      opexBuckets: [{ label: 'Labour', amount: 5_000_000, fixed: true }],
    });
    const recs = await advisor.recommend({
      analysis,
      benchmarks: {
        maxFuelShareOfOpex: 0.9,
        minNetMarginPercent: -1,
      },
    });
    expect(recs).toEqual([]);
  });
});
