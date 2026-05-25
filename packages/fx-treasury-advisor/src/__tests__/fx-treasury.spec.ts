/**
 * Happy-path tests for the FX-treasury advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createFxTreasuryAdvisor,
  type TreasuryInput,
} from '../index.js';

const NEXT_YEAR = new Date().getFullYear() + 1;

const SAMPLE_INPUT: TreasuryInput = {
  baseCurrency: 'TZS',
  horizonDays: 90,
  balances: [
    { accountId: 'tzs-1', currency: 'TZS', balance: 300_000_000, asOfISO: '2026-03-01' },
    { accountId: 'usd-1', currency: 'USD', balance: 40_000, asOfISO: '2026-03-01' },
  ],
  cashflows: [
    {
      id: 'royalty-2603',
      direction: 'out',
      dueISO: `${NEXT_YEAR}-03-26`,
      amount: 80_000,
      currency: 'USD',
      category: 'royalty',
    },
    {
      id: 'offtake-1504',
      direction: 'in',
      dueISO: `${NEXT_YEAR}-04-15`,
      amount: 120_000,
      currency: 'USD',
      category: 'off-take',
    },
  ],
  stockpiles: [
    { id: 'sp-A', tonnes: 50, estimatedSpotPricePerTonne: 2_000, ageDays: 14 },
  ],
  fxRates: [{ pair: 'USD/TZS', rate: 2_600, asOfISO: '2026-03-01' }],
  usdCliffDateISO: `${NEXT_YEAR}-03-27`,
};

describe('fx-treasury-advisor.analyze', () => {
  it('projects a runway with one entry per horizon day', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const advisor = createFxTreasuryAdvisor({ logger });
    const result = await advisor.analyze(SAMPLE_INPUT);
    expect(result.runway.points.length).toBe(SAMPLE_INPUT.horizonDays);
    expect(result.exposure.rows.length).toBeGreaterThanOrEqual(2);
    expect(logger.info).toHaveBeenCalledWith(
      'fx-treasury.analyze.start',
      expect.any(Object),
    );
  });
});

describe('fx-treasury-advisor.recommend', () => {
  it('emits a usd-cliff-remediation recommendation when USD outflow exceeds buffer', async () => {
    const advisor = createFxTreasuryAdvisor();
    const analysis = await advisor.analyze(SAMPLE_INPUT);
    const recs = await advisor.recommend({
      analysis,
      input: SAMPLE_INPUT,
      policy: { minRunwayDays: 30, maxSingleCurrencyExposureRatio: 0.9 },
    });
    const cliff = recs.find((r) => r.kind === 'usd-cliff-remediation');
    expect(cliff).toBeDefined();
    expect(cliff?.severity).toBe('critical');
    expect(cliff?.evidence.length).toBeGreaterThan(0);
  });
});
