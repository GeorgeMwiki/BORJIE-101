/**
 * Proactive-intel TickInputs provider tests (W3a).
 *
 * Locks the generative DATA-FEED contract the proactive-intel worker depends on:
 *
 *   1. POPULATED — for a seeded tenant the provider assembles the three slices
 *      the SHIPPED detectors read (cashflow / royaltyArrears / customerOwners)
 *      from the bounded, tenant-scoped, parameterised SELECTs, and the values
 *      flow through the real `@borjie/proactive-intel` detectors to produce an
 *      event (proves the wiring is live end-to-end, not just shape-correct).
 *   2. NEUTRAL — an empty source yields a neutral default the detector
 *      self-skips on (empty/absent slice), never a crash, never a fabricated
 *      signal.
 *   3. FAIL-SAFE — a slice whose query throws degrades THAT slice to neutral +
 *      warns, while the other slices still assemble.
 *   4. NO-DB — with no query port wired every slice is neutral ({}).
 *
 * No DB / network: a routing stub query port returns canned rows per table.
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { describe, it, expect } from 'vitest';
import {
  detectCashflowDip,
  detectRoyaltyArrearsSpike,
  detectChurnRisk,
  type TickContext,
} from '@borjie/proactive-intel';

import {
  createTickInputsProvider,
  type TickInputsQueryPort,
} from '../tick-inputs-provider.js';

type TickInputsShape = TickContext['inputs'];

const NOOP_LOGGER = {
  warn: (_meta: Record<string, unknown>, _msg: string) => undefined,
};

const TENANT = 'tenant-w3a';
const NOW = Date.UTC(2026, 5, 9, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

type Rows = ReadonlyArray<Record<string, unknown>>;

/**
 * A query port that routes by which table the SQL targets and returns the canned
 * rows for that table. A table mapped to `'throw'` makes that slice's read fail
 * (to exercise the per-slice fail-safe). It also records every call.
 */
function routingPort(tables: Record<string, Rows | 'throw'>): {
  port: TickInputsQueryPort;
  calls: Array<{ sql: string; params: ReadonlyArray<unknown> }>;
} {
  const calls: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  function pick(sql: string): Rows | 'throw' {
    if (/cash_balances/.test(sql)) return tables.cash_balances ?? [];
    if (/forecasts/.test(sql)) return tables.forecasts ?? [];
    if (/from\s+public\.sales/i.test(sql)) return tables.sales ?? [];
    if (/buyers/.test(sql)) return tables.buyers ?? [];
    return [];
  }
  return {
    calls,
    port: {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<ReadonlyArray<Row>> {
        calls.push({ sql, params: params ?? [] });
        const result = pick(sql);
        if (result === 'throw') throw new Error('boom');
        return result as ReadonlyArray<Row>;
      },
    },
  };
}

function ctxFor(inputs: TickInputsShape): TickContext {
  return {
    scope: 'tenant',
    tenantId: TENANT,
    nowMs: NOW,
    inputs,
  };
}

describe('createTickInputsProvider', () => {
  it('assembles a populated TickInputs that drives the real detectors', async () => {
    const { port, calls } = routingPort({
      cash_balances: [{ balance_tzs: '1000000.00' }],
      // A forecast path that dips well below the 0 safety floor → cashflow-dip.
      forecasts: [
        { low: '-500000', mid: '-200000', high: '50000', horizon_days: 3 },
      ],
      // 5 baseline weeks at ~2 arrears, then a spike to 8 → arrears-spike fires.
      sales: [
        { week_start: new Date(NOW - 5 * WEEK), arrears_count: '2' },
        { week_start: new Date(NOW - 4 * WEEK), arrears_count: '2' },
        { week_start: new Date(NOW - 3 * WEEK), arrears_count: '1' },
        { week_start: new Date(NOW - 2 * WEEK), arrears_count: '3' },
        { week_start: new Date(NOW - 1 * WEEK), arrears_count: '2' },
        { week_start: new Date(NOW), arrears_count: '8' },
      ],
      // A buyer that fell from 6 sales to 0 and has a 40-day-old unpaid sale.
      buyers: [
        {
          buyer_id: 'buyer-1',
          sales_30d: '0',
          sales_prior_30d: '6',
          oldest_pending_secs: String(40 * 24 * 60 * 60),
        },
      ],
    });

    const provider = createTickInputsProvider({ query: port, logger: NOOP_LOGGER });
    const inputs = await provider.inputsForTenant({ tenantId: TENANT, nowMs: NOW });

    // Shape: all three slices present + tenant-scoped.
    expect(inputs.cashflow?.tenantId).toBe(TENANT);
    expect(inputs.cashflow?.cashBalanceNow).toBe(1_000_000);
    expect(inputs.cashflow?.bands.length).toBe(1);
    expect(inputs.royaltyArrears?.weeks.length).toBe(6);
    expect(inputs.customerOwners?.length).toBe(1);
    expect(inputs.customerOwners?.[0]?.customerOwnerId).toBe('buyer-1');

    // Every read was tenant-scoped (tenantId is the first bound param).
    for (const call of calls) {
      expect(call.params[0]).toBe(TENANT);
    }

    // End-to-end: the assembled inputs actually fire the shipped detectors.
    const ctx = ctxFor(inputs);
    expect(detectCashflowDip(ctx).length).toBeGreaterThan(0);
    expect(detectRoyaltyArrearsSpike(ctx).length).toBeGreaterThan(0);
    expect(detectChurnRisk(ctx).length).toBeGreaterThan(0);
  });

  it('returns neutral defaults when sources are empty (no detector fires, no crash)', async () => {
    const { port } = routingPort({
      cash_balances: [], // no balance → no cashflow slice at all
      forecasts: [],
      sales: [], // empty series → arrears detector self-skips
      buyers: [], // no buyers → empty churn slice
    });

    const provider = createTickInputsProvider({ query: port, logger: NOOP_LOGGER });
    const inputs = await provider.inputsForTenant({ tenantId: TENANT, nowMs: NOW });

    // No cash balance → the slice is omitted entirely (the neutral the detector
    // skips on); royaltyArrears is present-but-empty; customerOwners empty.
    expect(inputs.cashflow).toBeUndefined();
    expect(inputs.royaltyArrears?.weeks).toEqual([]);
    expect(inputs.customerOwners).toEqual([]);

    const ctx = ctxFor(inputs);
    expect(detectCashflowDip(ctx)).toEqual([]);
    expect(detectRoyaltyArrearsSpike(ctx)).toEqual([]);
    expect(detectChurnRisk(ctx)).toEqual([]);
  });

  it('degrades a single failing slice to neutral while the others assemble', async () => {
    const { port } = routingPort({
      cash_balances: 'throw', // this slice faults
      forecasts: [],
      sales: [
        { week_start: new Date(NOW - 1 * WEEK), arrears_count: '2' },
        { week_start: new Date(NOW), arrears_count: '3' },
      ],
      buyers: [
        {
          buyer_id: 'buyer-2',
          sales_30d: '1',
          sales_prior_30d: '1',
          oldest_pending_secs: '0',
        },
      ],
    });

    const provider = createTickInputsProvider({ query: port, logger: NOOP_LOGGER });
    const inputs = await provider.inputsForTenant({ tenantId: TENANT, nowMs: NOW });

    // The faulting cashflow slice is dropped; the others still resolved.
    expect(inputs.cashflow).toBeUndefined();
    expect(inputs.royaltyArrears).toBeDefined();
    expect(inputs.customerOwners?.length).toBe(1);
  });

  it('returns {} when no query port is wired (no DB)', async () => {
    const provider = createTickInputsProvider({ logger: NOOP_LOGGER });
    const inputs = await provider.inputsForTenant({ tenantId: TENANT, nowMs: NOW });
    expect(inputs).toEqual({});
  });
});
