/**
 * Wave-K W-Data — dp-aggregator with unified budget composer (G2).
 *
 * Verifies the two budget paths:
 *   1. Composer path: when `budgetComposer` is provided, reads/writes
 *      flow through it and the legacy ledger is NOT touched.
 *   2. Legacy path: when `budgetComposer` is absent, the legacy
 *      ledger is debited (back-compat for unmigrated callers).
 *   3. Budget-exceeded path returns the structured refusal.
 *   4. Both paths produce the same `published`/`refused` outcome for
 *      the same logical input.
 *
 * Real in-memory adapters — no mocks, no spies.
 */

import { describe, it, expect } from 'vitest';
import {
  createDpAggregator,
  type PrivacyBudgetComposerLike,
} from '../dp-aggregator.js';
import { createInMemoryBudgetLedger } from '../../budget-ledger.js';
import { UNSAFE_createSeededNoiseSource } from '../../noise.js';
import type {
  AggregateStat,
  DPMechanism,
  PlatformAuthContext,
  PlatformSlice,
  TenantAggregateSource,
} from '../../types.js';

const PLATFORM_CTX: PlatformAuthContext = Object.freeze({
  kind: 'platform',
  actorUserId: 'usr_admin_test',
  roles: ['platform-admin'],
});

const SLICE: PlatformSlice = Object.freeze({
  jurisdictions: ['KE'],
  propertyClasses: ['A'],
  from: '2026-01-01T00:00:00Z',
  to: '2026-04-01T00:00:00Z',
});

const MECH: DPMechanism = {
  kind: 'laplace',
  epsilon: 0.5,
  sensitivity: 1,
};

function realTenantSource(
  tenants: ReadonlyArray<{ readonly id: string; readonly values: ReadonlyArray<number> }>,
): TenantAggregateSource {
  return {
    async eligibleTenants() {
      return tenants.map((t) => t.id);
    },
    async contributionsFor({ tenantId }) {
      const t = tenants.find((x) => x.id === tenantId);
      if (!t) throw new Error(`tenant ${tenantId} not found`);
      return t.values;
    },
  };
}

interface ComposerCall {
  readonly op: 'check' | 'spend';
  readonly tenantId: string;
  readonly epsilon: number;
}

function realComposer(opts: {
  totalEpsilon: number;
}): { composer: PrivacyBudgetComposerLike; calls: ComposerCall[]; remaining: () => number } {
  const calls: ComposerCall[] = [];
  let spent = 0;
  const composer: PrivacyBudgetComposerLike = {
    async checkBudgetAvailable({ tenantId, requestedEpsilon }) {
      calls.push({ op: 'check', tenantId, epsilon: requestedEpsilon });
      const remaining = opts.totalEpsilon - spent;
      if (requestedEpsilon > remaining) {
        return {
          ok: false,
          reason: 'epsilon-exhausted',
          remainingEpsilon: remaining,
          remainingDelta: 1,
        };
      }
      return { ok: true, reason: null, remainingEpsilon: remaining, remainingDelta: 1 };
    },
    async recordSpend({ tenantId, epsilon }) {
      calls.push({ op: 'spend', tenantId, epsilon });
      spent += epsilon;
      return undefined;
    },
  };
  return { composer, calls, remaining: () => opts.totalEpsilon - spent };
}

const tenantSource = realTenantSource([
  { id: 't1', values: [0.04, 0.05] },
  { id: 't2', values: [0.07, 0.03] },
  { id: 't3', values: [0.02, 0.04] },
  { id: 't4', values: [0.06, 0.05] },
  { id: 't5', values: [0.03, 0.05] },
]);

describe('dp-aggregator / composer path (Wave-K W-Data)', () => {
  it('routes budget reservation through the composer when provided', async () => {
    const { composer, calls } = realComposer({ totalEpsilon: 5 });
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(2026);
    const agg = createDpAggregator({
      tenantSource,
      ledger,
      budgetComposer: composer,
      noise,
    });

    const outcome = await agg.aggregate(
      {
        statistic: 'arrears_rate' as AggregateStat,
        slice: SLICE,
        mechanism: MECH,
        kMin: 5,
      },
      PLATFORM_CTX,
    );
    expect(outcome.kind).toBe('published');
    // Composer should have seen one check + one spend
    expect(calls.filter((c) => c.op === 'check')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'spend')).toHaveLength(1);
    // Legacy ledger should NOT have been debited (composer wins).
    const ledgerSnap = await ledger.snapshot();
    expect(ledgerSnap.spentEpsilon).toBe(0);
  });

  it('legacy path debits the old ledger when no composer is wired', async () => {
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(2026);
    const agg = createDpAggregator({
      tenantSource,
      ledger,
      noise,
    });

    const outcome = await agg.aggregate(
      {
        statistic: 'arrears_rate' as AggregateStat,
        slice: SLICE,
        mechanism: MECH,
        kMin: 5,
      },
      PLATFORM_CTX,
    );
    expect(outcome.kind).toBe('published');
    const snap = await ledger.snapshot();
    expect(snap.spentEpsilon).toBeCloseTo(0.5, 4);
  });

  it('budget-exhausted on composer path returns structured refusal', async () => {
    const { composer } = realComposer({ totalEpsilon: 0.1 });
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(2026);
    const agg = createDpAggregator({
      tenantSource,
      ledger,
      budgetComposer: composer,
      noise,
    });
    const outcome = await agg.aggregate(
      {
        statistic: 'arrears_rate' as AggregateStat,
        slice: SLICE,
        mechanism: MECH,
        kMin: 5,
      },
      PLATFORM_CTX,
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.reason).toBe('platform_budget_exhausted');
    }
  });

  it('both paths agree on outcome for the same input (published)', async () => {
    const ledgerLegacy = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noiseLegacy = UNSAFE_createSeededNoiseSource(2026);
    const aggLegacy = createDpAggregator({
      tenantSource,
      ledger: ledgerLegacy,
      noise: noiseLegacy,
    });

    const { composer } = realComposer({ totalEpsilon: 5 });
    const ledger = createInMemoryBudgetLedger({ totalEpsilon: 5 });
    const noise = UNSAFE_createSeededNoiseSource(2026);
    const aggComposer = createDpAggregator({
      tenantSource,
      ledger,
      budgetComposer: composer,
      noise,
    });

    const q = {
      statistic: 'arrears_rate' as AggregateStat,
      slice: SLICE,
      mechanism: MECH,
      kMin: 5,
    };
    const a = await aggLegacy.aggregate(q, PLATFORM_CTX);
    const b = await aggComposer.aggregate(q, PLATFORM_CTX);
    expect(a.kind).toBe(b.kind);
  });
});
