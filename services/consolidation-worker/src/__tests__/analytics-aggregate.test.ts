/**
 * runAnalyticsAggregate — pure orchestrator tests (WS-4).
 *
 * The aggregation SQL itself is proven against a real Postgres in the database
 * package integration suite. Here we assert the worker shell:
 *   - scans every listed tenant and calls BOTH aggregators per tenant;
 *   - sums the upsert counts into the result;
 *   - never throws: a single failing tenant is counted, not propagated;
 *   - threads each tenant's primary currency into the growth aggregator (the
 *     fallback when a tenant has no ledger lines — never a hardcoded default).
 */

import { describe, it, expect } from 'vitest';
import {
  runAnalyticsAggregate,
  type AnalyticsAggregators,
  type AnalyticsTenantLister,
  type AnalyticsTenant,
} from '../tasks/analytics-aggregate.js';

function lister(tenants: AnalyticsTenant[]): AnalyticsTenantLister {
  return { list: async () => tenants };
}

describe('runAnalyticsAggregate', () => {
  it('aggregates usage + growth for every tenant and sums upserts', async () => {
    const calls: Array<{ kind: string; tenantId: string; currency?: string }> = [];
    const aggregators: AnalyticsAggregators = {
      async usageDaily(tenantId) {
        calls.push({ kind: 'usage', tenantId });
        return { upserted: 2 };
      },
      async growthMonthly(tenantId, _anchor, defaultCurrency) {
        calls.push({ kind: 'growth', tenantId, currency: defaultCurrency });
        return { upserted: 1 };
      },
    };

    const result = await runAnalyticsAggregate(
      {
        tenants: lister([
          { tenantId: 't1', primaryCurrency: 'TZS' },
          { tenantId: 't2', primaryCurrency: 'KES' },
        ]),
        aggregators,
      },
      { now: new Date(Date.UTC(2026, 4, 15)) },
    );

    expect(result.scanned).toBe(2);
    expect(result.usageUpserted).toBe(4); // 2 tenants × 2
    expect(result.growthUpserted).toBe(2); // 2 tenants × 1
    expect(result.failed).toBe(0);

    // Growth aggregator received each tenant's own currency (not a hardcode).
    expect(calls).toContainEqual({ kind: 'growth', tenantId: 't1', currency: 'TZS' });
    expect(calls).toContainEqual({ kind: 'growth', tenantId: 't2', currency: 'KES' });
  });

  it('counts a failing tenant without poisoning the batch', async () => {
    const aggregators: AnalyticsAggregators = {
      async usageDaily(tenantId) {
        if (tenantId === 'bad') throw new Error('boom');
        return { upserted: 1 };
      },
      async growthMonthly() {
        return { upserted: 1 };
      },
    };

    const result = await runAnalyticsAggregate({
      tenants: lister([
        { tenantId: 'ok', primaryCurrency: 'TZS' },
        { tenantId: 'bad', primaryCurrency: 'TZS' },
      ]),
      aggregators,
    });

    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.usageUpserted).toBe(1); // only the good tenant
    expect(result.growthUpserted).toBe(1);
  });

  it('uses the configured usage lookback window', async () => {
    let capturedFrom: Date | null = null;
    const aggregators: AnalyticsAggregators = {
      async usageDaily(_t, from) {
        capturedFrom = from;
        return { upserted: 0 };
      },
      async growthMonthly() {
        return { upserted: 0 };
      },
    };

    const now = new Date(Date.UTC(2026, 4, 31));
    await runAnalyticsAggregate(
      { tenants: lister([{ tenantId: 't1', primaryCurrency: 'TZS' }]), aggregators },
      { now, usageLookbackDays: 7 },
    );

    expect(capturedFrom).not.toBeNull();
    const days = Math.round(
      (now.getTime() - (capturedFrom as unknown as Date).getTime()) / 86_400_000,
    );
    expect(days).toBe(7);
  });
});
