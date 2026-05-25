import { describe, it, expect } from 'vitest';
import { waterMainCrisisScenario } from '../../scenarios/library/water-main-crisis.js';
import { defaultIntentFor } from '../../world-model/business-archetype.js';
import type { BusinessContext, Sandbox } from '../../types.js';

function stubSandbox(): Sandbox {
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

function makeCtx(): BusinessContext {
  const dayMs = 86_400_000;
  return {
    orgId: 'org-x',
    tenants: [
      { tenantId: 't1', unitId: 'u1', tenureDays: 200, monthlyRent: 50_000, paymentReliability: 0.9, leaseEndsAt: Date.now() + 365 * dayMs },
      { tenantId: 't2', unitId: 'u2', tenureDays: 800, monthlyRent: 45_000, paymentReliability: 0.85, leaseEndsAt: Date.now() + 365 * dayMs },
    ],
    units: [
      { unitId: 'u1', propertyId: 'p1', microMarketId: 'mm1', occupied: true, listedRent: 50_000 },
      { unitId: 'u2', propertyId: 'p1', microMarketId: 'mm1', occupied: true, listedRent: 45_000 },
    ],
    cashBalance: 500_000,
    horizonDays: 90,
    nowMs: Date.now(),
    ownerIntent: defaultIntentFor('preservation'),
    historicalCashflow: [],
  };
}

describe('water-main-crisis scenario', () => {
  it('produces negative first-month NOI and retention drop', async () => {
    const ctx = makeCtx();
    const outcome = await waterMainCrisisScenario.run(
      {
        affectedUnitIds: ['u1', 'u2'],
        repairCost: 200_000,
        repairDays: 7,
        abatementPctOfRent: 0.5,
        vendorCount: 2,
      },
      { business: ctx, sandbox: stubSandbox(), seed: 11 },
    );
    expect(outcome.scenarioName).toBe('water-main-crisis');
    expect(outcome.projectedNoi[0]?.p50).toBeLessThan(0);
    expect(outcome.retentionProbability).toBeLessThan(0.95);
    expect(outcome.notes.some((n) => /Repair/.test(n))).toBe(true);
  });

  it('higher repair cost than cash balance → high shortfall probability', async () => {
    const ctx = makeCtx();
    const outcome = await waterMainCrisisScenario.run(
      {
        affectedUnitIds: ['u1'],
        repairCost: 5_000_000,
        repairDays: 14,
        abatementPctOfRent: 0.5,
        vendorCount: 1,
      },
      { business: ctx, sandbox: stubSandbox(), seed: 11 },
    );
    expect(outcome.cashShortfallProbability).toBeGreaterThan(0.5);
  });
});
