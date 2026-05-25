/**
 * DP aggregator — live-behaviour tests.
 *
 * These tests exercise the REAL aggregator against REAL in-memory
 * tenant sources and a REAL ledger. No mocks — the sources implement
 * the full port contract with deterministic data. Seeded noise so
 * expectations are reproducible.
 */

import { describe, it, expect } from 'vitest';
import { createDpAggregator } from '../aggregators/dp-aggregator.js';
import {
  createInMemoryBudgetLedger,
} from '../budget-ledger.js';
import { UNSAFE_createSeededNoiseSource } from '../noise.js';
import type {
  AggregateStat,
  DPMechanism,
  PlatformAuthContext,
  PlatformSlice,
  TenantAggregateSource,
} from '../types.js';

const PLATFORM_CTX: PlatformAuthContext = Object.freeze({
  kind: 'platform',
  actorUserId: 'user_platform_admin_test',
  roles: ['platform-admin'],
});

const SLICE: PlatformSlice = Object.freeze({
  jurisdictions: ['KE'],
  propertyClasses: ['A', 'B'],
  from: '2026-01-01T00:00:00Z',
  to:   '2026-04-01T00:00:00Z',
});

const LAPLACE: DPMechanism = {
  kind: 'laplace',
  epsilon: 0.5,
  sensitivity: 1,
};

/** A real tenant source backed by an in-memory Map — satisfies the
 *  port exactly, no mocking framework. */
function realTenantSource(
  tenants: ReadonlyArray<{ readonly id: string; readonly values: ReadonlyArray<number> }>,
): TenantAggregateSource {
  return {
    async eligibleTenants(): Promise<ReadonlyArray<string>> {
      return tenants.map((t) => t.id);
    },
    async contributionsFor({ tenantId }) {
      const t = tenants.find((x) => x.id === tenantId);
      if (!t) throw new Error(`tenant ${tenantId} not found`);
      return t.values;
    },
  };
}

describe('dp-aggregator / live behaviour', () => {
  it('publishes an aggregate when k-anonymity is met', async () => {
    const tenantSource = realTenantSource([
      { id: 't1', values: [0.04, 0.05, 0.06] },
      { id: 't2', values: [0.07, 0.03] },
      { id: 't3', values: [0.02, 0.01, 0.04, 0.05] },
      { id: 't4', values: [0.06, 0.05] },
      { id: 't5', values: [0.03, 0.04, 0.05] },
    ]);
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(2026);
    const agg = createDpAggregator({ tenantSource, ledger, noise });

    const outcome = await agg.aggregate(
      {
        statistic: 'arrears_rate' as AggregateStat,
        slice: SLICE,
        mechanism: LAPLACE,
        kMin: 5,
      },
      PLATFORM_CTX,
    );

    expect(outcome.kind).toBe('published');
    if (outcome.kind !== 'published') throw new Error('expected published');
    expect(outcome.contributingTenants).toBe(5);
    expect(outcome.privacyCost).toBeCloseTo(0.5);
    // Expected raw ≈ mean-of-means of contributions ≈ 0.042;
    // noise at ε=0.5, Δ=1 → scale 2. The noised value must be a
    // finite number; exact value depends on seed but must be
    // deterministic across runs.
    expect(Number.isFinite(outcome.noisedValue)).toBe(true);
  });

  it('refuses when fewer tenants than k-min match the slice', async () => {
    const tenantSource = realTenantSource([
      { id: 't1', values: [1] },
      { id: 't2', values: [0] },
    ]);
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(1);
    const agg = createDpAggregator({ tenantSource, ledger, noise });

    const outcome = await agg.aggregate(
      { statistic: 'arrears_rate', slice: SLICE, mechanism: LAPLACE, kMin: 5 },
      PLATFORM_CTX,
    );

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.reason).toBe('k_anonymity_not_met');

    // Budget must NOT have been debited by the refused call
    const snap = await ledger.snapshot();
    expect(snap.spentEpsilon).toBe(0);
  });

  it('refuses when the platform budget would be exhausted', async () => {
    const tenants = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      values: [0.05, 0.06, 0.04],
    }));
    const tenantSource = realTenantSource(tenants);
    // Budget just below one query's cost
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 0.4 });
    const noise = UNSAFE_createSeededNoiseSource(7);
    const agg = createDpAggregator({ tenantSource, ledger, noise });

    const outcome = await agg.aggregate(
      { statistic: 'arrears_rate', slice: SLICE, mechanism: LAPLACE, kMin: 5 },
      PLATFORM_CTX,
    );

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.reason).toBe('platform_budget_exhausted');
  });

  it('rejects a tenant AuthContext kind', async () => {
    const tenantSource = realTenantSource([
      { id: 't1', values: [1] },
      { id: 't2', values: [0] },
    ]);
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(1);
    const agg = createDpAggregator({ tenantSource, ledger, noise });

    await expect(
      agg.aggregate(
        { statistic: 'arrears_rate', slice: SLICE, mechanism: LAPLACE, kMin: 2 },
        { kind: 'tenant', tenantId: 't1', actorUserId: 'u', roles: [] } as never,
      ),
    ).rejects.toThrow(/platform/);
  });
});
