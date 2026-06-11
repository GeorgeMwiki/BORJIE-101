/**
 * Tests for the proactive-intel worker — Wave 2b (W2b).
 *
 * Covers the keystone wiring claim: ONE tick over a seeded detector input
 * (a cashflow slice that dips below the tenant's safety floor) drives the
 * REAL @borjie/proactive-intel detector + composer and routes the resulting
 * recommendation into the (mocked) cockpit delivery sink as a
 * `mwikila.proposes` event.
 *
 * Also covers the fail-safe contract:
 *   - no inputs provider → idle (warn once, zero delivered).
 *   - a per-tenant inputs fault is isolated (other tenants still tick).
 *   - a DB read failure degrades to a zero-tenant tick (never throws).
 *   - `enabled: false` short-circuits.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CockpitEvent } from '../../services/cockpit-events';
import {
  createProactiveIntelWorker,
  type ProactiveIntelInputsProvider,
} from '../proactive-intel.worker';

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as never;
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/** DB stub: the worker's only query is the active-tenant SELECT. */
function tenantDb(tenantIds: readonly string[]): DbLike {
  return {
    async execute() {
      return { rows: tenantIds.map((id) => ({ id })) };
    },
  };
}

/** A failing DB stub — the active-tenant read rejects. */
function failingDb(): DbLike {
  return {
    async execute() {
      throw new Error('simulated DB outage');
    },
  };
}

/**
 * Seed a cashflow slice that dips below the safety floor in ~5 days so the
 * REAL `detectCashflowDip` fires a P0 anomaly for this tenant.
 */
function cashflowDipProvider(tenantId: string): ProactiveIntelInputsProvider {
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    async inputsForTenant({ nowMs }) {
      return {
        cashflow: {
          tenantId,
          cashBalanceNow: 100_000,
          horizonDays: 14,
          safetyFloor: 50_000,
          bands: [
            { t: nowMs, p10: 90_000, p50: 100_000, p90: 110_000 },
            { t: nowMs + 5 * dayMs, p10: 30_000, p50: 45_000, p90: 60_000 },
          ],
        },
      };
    },
  };
}

describe('proactive-intel.worker', () => {
  it('delivers one mwikila.proposes insight when a seeded detector input fires', async () => {
    const delivered: CockpitEvent[] = [];
    const worker = createProactiveIntelWorker({
      db: tenantDb(['tnt-1']),
      logger: fakeLogger(),
      inputsForTenant: cashflowDipProvider('tnt-1'),
      publish: (event) => {
        delivered.push(event);
        return 1;
      },
    });

    const result = await worker.tickOnce();

    expect(result.tenants).toBe(1);
    expect(result.detected).toBeGreaterThanOrEqual(1);
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const proposal = delivered.find((e) => e.kind === 'mwikila.proposes');
    expect(proposal).toBeDefined();
    if (proposal && proposal.kind === 'mwikila.proposes') {
      expect(proposal.tenantId).toBe('tnt-1');
      expect(proposal.actionKind).toContain('cashflow-dip');
      expect(proposal.category).toBe('anomaly');
      // A ~5-day dip is P0 → mapped to the T1 owner-sign-off tier.
      expect(proposal.delegationTier).toBe('T1');
      expect(proposal.summary.length).toBeGreaterThan(0);
    }
  });

  it('idles (delivers nothing) when no inputs provider is wired', async () => {
    const delivered: CockpitEvent[] = [];
    const worker = createProactiveIntelWorker({
      db: tenantDb(['tnt-1']),
      logger: fakeLogger(),
      publish: (event) => {
        delivered.push(event);
        return 1;
      },
    });

    const result = await worker.tickOnce();

    expect(result.tenants).toBe(1);
    expect(result.detected).toBe(0);
    expect(result.delivered).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it('isolates a per-tenant inputs fault — other tenants still tick', async () => {
    const delivered: CockpitEvent[] = [];
    const goodProvider = cashflowDipProvider('tnt-good');
    const provider: ProactiveIntelInputsProvider = {
      async inputsForTenant(input) {
        if (input.tenantId === 'tnt-bad') {
          throw new Error('inputs source exploded');
        }
        return goodProvider.inputsForTenant(input);
      },
    };

    const worker = createProactiveIntelWorker({
      db: tenantDb(['tnt-bad', 'tnt-good']),
      logger: fakeLogger(),
      inputsForTenant: provider,
      publish: (event) => {
        delivered.push(event);
        return 1;
      },
    });

    const result = await worker.tickOnce();

    expect(result.tenants).toBe(2);
    expect(result.failed).toBe(0); // the fault is swallowed, not counted as a throw
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(
      delivered.some(
        (e) => e.kind === 'mwikila.proposes' && e.tenantId === 'tnt-good',
      ),
    ).toBe(true);
    expect(
      delivered.some(
        (e) => e.kind === 'mwikila.proposes' && e.tenantId === 'tnt-bad',
      ),
    ).toBe(false);
  });

  it('degrades to a zero-tenant tick when the DB read fails (never throws)', async () => {
    const worker = createProactiveIntelWorker({
      db: failingDb(),
      logger: fakeLogger(),
      inputsForTenant: cashflowDipProvider('tnt-1'),
      publish: () => 1,
    });

    const result = await worker.tickOnce();

    expect(result.tenants).toBe(0);
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('short-circuits when disabled', async () => {
    const publish = vi.fn(() => 1);
    const worker = createProactiveIntelWorker({
      db: tenantDb(['tnt-1']),
      logger: fakeLogger(),
      inputsForTenant: cashflowDipProvider('tnt-1'),
      publish,
      enabled: false,
    });

    const result = await worker.tickOnce();

    expect(result).toEqual({ tenants: 0, detected: 0, delivered: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
  });
});
