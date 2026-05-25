import { describe, it, expect } from 'vitest';
import { WorldModel } from '../world-model/world-model.js';
import { TenantGraph } from '../world-model/tenant-graph.js';
import { CashflowState } from '../world-model/cashflow-state.js';
import { ComplianceState } from '../world-model/compliance-state.js';
import { MarketCache } from '../world-model/market-cache.js';
import { defaultIntentFor, listArchetypes } from '../world-model/business-archetype.js';
import type { BusinessContext } from '../types.js';

function makeContext(): BusinessContext {
  return {
    orgId: 'org-test',
    tenants: [
      { tenantId: 't1', unitId: 'u1', tenureDays: 365, monthlyRent: 50_000, paymentReliability: 0.95, leaseEndsAt: Date.now() + 365 * 86_400_000 },
      { tenantId: 't2', unitId: 'u2', tenureDays: 180, monthlyRent: 45_000, paymentReliability: 0.85, leaseEndsAt: Date.now() + 200 * 86_400_000 },
    ],
    units: [
      { unitId: 'u1', propertyId: 'p1', microMarketId: 'mm1', occupied: true, listedRent: 50_000 },
      { unitId: 'u2', propertyId: 'p1', microMarketId: 'mm1', occupied: true, listedRent: 45_000 },
      { unitId: 'u3', propertyId: 'p1', microMarketId: 'mm1', occupied: false, listedRent: 48_000 },
    ],
    cashBalance: 1_000_000,
    horizonDays: 90,
    nowMs: Date.now(),
    ownerIntent: defaultIntentFor('cashflow-first'),
    historicalCashflow: Array.from({ length: 12 }, (_, i) => ({ t: i * 86_400_000 * 30, v: 95_000 + Math.sin(i) * 5_000 })),
  };
}

describe('WorldModel', () => {
  it('reports occupancy + rent roll', () => {
    const wm = WorldModel.fromContext(makeContext());
    expect(wm.occupancyRate()).toBeCloseTo(2 / 3, 5);
    expect(wm.monthlyRentRoll()).toBe(95_000);
  });

  it('is immutable on cash update', () => {
    const wm = WorldModel.fromContext(makeContext());
    const next = wm.withCashBalance(500);
    expect(wm.state.cashBalance).toBe(1_000_000);
    expect(next.state.cashBalance).toBe(500);
    expect(next.state.version).toBe(wm.state.version + 1);
  });

  it('is immutable on unit update', () => {
    const wm = WorldModel.fromContext(makeContext());
    const next = wm.withUnit('u3', { occupied: true });
    expect(wm.state.units.find((u) => u.unitId === 'u3')?.occupied).toBe(false);
    expect(next.state.units.find((u) => u.unitId === 'u3')?.occupied).toBe(true);
  });
});

describe('TenantGraph', () => {
  it('builds neighbour adjacency from shared property', () => {
    const ctx = makeContext();
    const g = TenantGraph.build(ctx.tenants, ctx.units);
    expect(g.size()).toBe(2);
    expect(g.neighboursOf('t1')).toContain('t2');
    expect(g.neighboursOf('t1')).not.toContain('t1');
  });
});

describe('CashflowState', () => {
  it('applies events immutably and tracks min balance', () => {
    const cf = CashflowState.initial(100).apply({ t: 0, amount: -120, kind: 'expense' });
    expect(cf.snapshot.balance).toBe(-20);
    expect(cf.snapshot.minBalance).toBe(-20);
    expect(cf.snapshot.events.length).toBe(1);
  });
});

describe('ComplianceState', () => {
  it('flags overdue filings + computes score', () => {
    const now = Date.now();
    const c0 = ComplianceState.initial([
      { id: 'f1', kind: 'KRA-VAT', dueAt: now - 1000, status: 'open', readiness: 0.5 },
      { id: 'f2', kind: 'KRA-MRI', dueAt: now + 1_000_000, status: 'open', readiness: 0.8 },
    ]);
    const advanced = c0.advanceTo(now);
    expect(advanced.snapshot.violations).toBe(1);
    expect(advanced.complianceScore()).toBeLessThan(c0.complianceScore());
  });

  it('marks submitted filings and bumps score back', () => {
    const c0 = ComplianceState.initial([
      { id: 'f1', kind: 'KRA-VAT', dueAt: Date.now() + 1000, status: 'open', readiness: 0.4 },
    ]);
    const c1 = c0.markSubmitted('f1');
    expect(c1.complianceScore()).toBe(1);
  });
});

describe('MarketCache', () => {
  it('returns defaults when market missing', () => {
    const cache = new MarketCache();
    const sig = cache.getOrDefault('unknown');
    expect(sig.vacancyRate).toBe(0.05);
  });

  it('updates immutably on with()', () => {
    const c0 = new MarketCache();
    const c1 = c0.with({
      microMarketId: 'mm1',
      medianRent: 50_000,
      vacancyRate: 0.07,
      daysToLeaseMedian: 21,
      demandIndex: 1.1,
      updatedAtMs: Date.now(),
    });
    expect(c0.size()).toBe(0);
    expect(c1.size()).toBe(1);
    expect(c1.get('mm1')?.medianRent).toBe(50_000);
  });
});

describe('BusinessArchetype', () => {
  it('lists 4 archetypes', () => {
    expect(listArchetypes().length).toBe(4);
  });

  it('weights sum to 1 for each archetype', () => {
    for (const a of listArchetypes()) {
      const intent = defaultIntentFor(a);
      const sum =
        intent.weights.cashflow +
        intent.weights.retention +
        intent.weights.compliance +
        intent.weights.intentAlignment;
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});
