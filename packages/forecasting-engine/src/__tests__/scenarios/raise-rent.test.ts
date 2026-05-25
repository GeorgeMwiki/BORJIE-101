import { describe, it, expect } from 'vitest';
import { simulate } from '../../orchestrator/simulate.js';
import { raiseRentScenario } from '../../scenarios/library/raise-rent.js';
import { defaultIntentFor } from '../../world-model/business-archetype.js';
import type { BusinessContext, ProposedAction } from '../../types.js';

function makePortfolio(unitCount: number): BusinessContext {
  const tenants = Array.from({ length: unitCount }, (_, i) => ({
    tenantId: `t${i}`,
    unitId: `u${i}`,
    tenureDays: 365 + i * 30,
    monthlyRent: 45_000 + i * 1_000,
    paymentReliability: 0.92,
    leaseEndsAt: Date.now() + 365 * 86_400_000,
  }));
  const units = Array.from({ length: unitCount }, (_, i) => ({
    unitId: `u${i}`,
    propertyId: 'p1',
    microMarketId: 'mm1',
    occupied: true,
    listedRent: 45_000 + i * 1_000,
  }));
  const dayMs = 86_400_000;
  const historicalCashflow = Array.from({ length: 24 }, (_, i) => ({
    t: i * 30 * dayMs,
    v: 450_000 + Math.sin((2 * Math.PI * i) / 12) * 20_000,
  }));
  return {
    orgId: 'org-test',
    tenants,
    units,
    cashBalance: 2_000_000,
    horizonDays: 365,
    nowMs: Date.now(),
    ownerIntent: defaultIntentFor('cashflow-first'),
    historicalCashflow,
  };
}

describe('raise-rent scenario', () => {
  it('produces ranked outcomes for a 10-unit portfolio', async () => {
    const ctx = makePortfolio(10);
    const action: ProposedAction = {
      kind: 'raise-rent',
      payload: {
        unitIds: ctx.units.map((u) => u.unitId),
        pctIncrease: 0.07,
        effectiveDateMs: ctx.nowMs + 30 * 86_400_000,
        microMarketVacancyRate: 0.05,
        marketDemandIndex: 1,
      },
      riskTier: 'mutate',
    };
    const result = await simulate({
      action,
      context: ctx,
      alternatives: [
        {
          scenario: raiseRentScenario as unknown as import('../../scenarios/scenario.js').AnyScenario,
          input: { ...action.payload, pctIncrease: 0.03 },
        },
        {
          scenario: raiseRentScenario as unknown as import('../../scenarios/scenario.js').AnyScenario,
          input: { ...action.payload, pctIncrease: 0.07 },
        },
        {
          scenario: raiseRentScenario as unknown as import('../../scenarios/scenario.js').AnyScenario,
          input: { ...action.payload, pctIncrease: 0.15 },
        },
      ],
    });
    expect(result.ranked.length).toBe(3);
    // Scoring is deterministic given inputs
    const scores = result.ranked.map((r) => r.score);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1] ?? 0);
    expect(scores[1]).toBeGreaterThanOrEqual(scores[2] ?? 0);
    expect(result.diffView.recommended).toBe('raise-rent');
  });

  it('lower pctIncrease → higher retention', async () => {
    const ctx = makePortfolio(5);
    const lowOutcome = await raiseRentScenario.run(
      {
        unitIds: ctx.units.map((u) => u.unitId),
        pctIncrease: 0.02,
        effectiveDateMs: ctx.nowMs,
        microMarketVacancyRate: 0.05,
        marketDemandIndex: 1,
      },
      { business: ctx, sandbox: stubSandbox(), seed: 1 },
    );
    const highOutcome = await raiseRentScenario.run(
      {
        unitIds: ctx.units.map((u) => u.unitId),
        pctIncrease: 0.15,
        effectiveDateMs: ctx.nowMs,
        microMarketVacancyRate: 0.05,
        marketDemandIndex: 1,
      },
      { business: ctx, sandbox: stubSandbox(), seed: 1 },
    );
    expect(lowOutcome.retentionProbability).toBeGreaterThan(
      highOutcome.retentionProbability,
    );
  });
});

function stubSandbox(): import('../../types.js').Sandbox {
  let map: ReadonlyMap<string, unknown> = new Map();
  return {
    runId: 'stub',
    createdAt: 0,
    mode: 'in-memory',
    async read<T>(k: string) {
      return map.get(k) as T | undefined;
    },
    async write<T>(k: string, v: T) {
      const next = new Map(map);
      next.set(k, v);
      map = next;
    },
    async dispose() {},
    isDisposed: () => false,
  };
}
