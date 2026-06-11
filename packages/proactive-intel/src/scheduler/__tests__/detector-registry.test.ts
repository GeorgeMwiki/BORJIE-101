/**
 * Detector-registry wiring tests.
 *
 * Proves the registry actually dispatches the detectors it claims to:
 *   1. All 4 scaffolded-then-wired anomaly detectors (cost-anomaly,
 *      slo-breach, compliance-deadline-near, vendor-reliability-drop) are
 *      registered AND fire end-to-end through runTick when their cadence
 *      runs against triggering inputs.
 *   2. The 3 unbuilt opportunity kinds (vendor-rate-arbitrage,
 *      policy-tightening, offtake-price-vs-market) are intentionally NOT
 *      registered — they have no source file, so the tick-runner must
 *      cleanly skip them via `if (!fn) continue;` and never throw.
 */
import { describe, expect, it } from 'vitest';
import {
  ANOMALY_DETECTORS,
  OPPORTUNITY_DETECTORS,
} from '../detector-registry.js';
import { runTick } from '../tick-runner.js';
import {
  HOT_CADENCE,
  WARM_CADENCE,
  COLD_CADENCE,
} from '../tick-cadences.js';
import type { TickContext } from '../tick-context.js';
import type { EntityStore } from '../../contracts/entity-store.js';
import type { AnomalyKind, OpportunityKind } from '../../contracts/events.js';

const NOW_MS = Date.parse('2026-06-08T12:00:00Z');
const TENANT = 'tenant_a';
const DAY_MS = 24 * 60 * 60 * 1000;

const WIRED_ANOMALY_KINDS: ReadonlyArray<AnomalyKind> = [
  'cashflow-dip',
  'royalty-arrears-spike',
  'churn-risk',
  'cost-anomaly',
  'slo-breach',
  'compliance-deadline-near',
  'vendor-reliability-drop',
];

const UNBUILT_OPPORTUNITY_KINDS: ReadonlyArray<OpportunityKind> = [
  'vendor-rate-arbitrage',
  'policy-tightening',
  'offtake-price-vs-market',
];

function collectingStore(): {
  readonly store: EntityStore;
  readonly written: Array<{ readonly kind: string; readonly id: string }>;
} {
  const written: Array<{ readonly kind: string; readonly id: string }> = [];
  const store: EntityStore = {
    async read() {
      return null;
    },
    async write(input) {
      written.push({ kind: input.kind, id: input.id });
      return {
        scope: input.scope,
        tenantId: input.tenantId,
        kind: input.kind,
        id: input.id,
        version: 1,
        createdAt: new Date(NOW_MS).toISOString(),
        updatedAt: new Date(NOW_MS).toISOString(),
        data: input.data,
      };
    },
    async list() {
      return [];
    },
    async delete() {
      return undefined;
    },
  };
  return { store, written };
}

function ctxWith(inputs: TickContext['inputs']): TickContext {
  return {
    scope: 'tenant',
    tenantId: TENANT,
    nowMs: NOW_MS,
    inputs,
  };
}

describe('detector-registry — anomaly wiring', () => {
  it('registers all 7 real anomaly detectors as callable functions', () => {
    for (const kind of WIRED_ANOMALY_KINDS) {
      expect(typeof ANOMALY_DETECTORS[kind]).toBe('function');
    }
  });

  it('cost-anomaly fires through the hot cadence on a spend surge', async () => {
    const ctx = ctxWith({
      cost: {
        tenantId: TENANT,
        aiCostUsdCents7d: 30_000,
        aiCostUsdCentsBaseline: 10_000,
      },
    });
    const { store, written } = collectingStore();
    const result = await runTick(ctx, HOT_CADENCE, store);
    const kinds = result.anomalies.map((a) => a.kind);
    expect(kinds).toContain('cost-anomaly');
    expect(written.some((w) => w.kind.endsWith('cost-anomaly'))).toBe(true);
  });

  it('slo-breach fires through the hot cadence on forecaster drift', async () => {
    const ctx = ctxWith({
      slo: [{ forecaster: 'cashflow-7d', mae7d: 0.5, mae30dBaseline: 0.2 }],
    });
    const { store } = collectingStore();
    const result = await runTick(ctx, HOT_CADENCE, store);
    expect(result.anomalies.map((a) => a.kind)).toContain('slo-breach');
  });

  it('vendor-reliability-drop fires through the warm cadence', async () => {
    const ctx = ctxWith({
      vendors: [
        {
          tenantId: TENANT,
          vendorId: 'v1',
          vendorName: 'Acme Drills',
          onTimeRate90d: 0.6,
          onTimeRatePrior: 0.95,
        },
      ],
    });
    const { store } = collectingStore();
    const result = await runTick(ctx, WARM_CADENCE, store);
    expect(result.anomalies.map((a) => a.kind)).toContain(
      'vendor-reliability-drop',
    );
  });

  it('compliance-deadline-near fires through the cold cadence', async () => {
    const ctx = ctxWith({
      complianceDeadlines: [
        {
          tenantId: TENANT,
          kind: 'royalty-return',
          dueAtMs: NOW_MS + 2 * DAY_MS,
          subjectId: 'ret_1',
          subjectLabel: 'Q2 royalty return',
        },
      ],
    });
    const { store } = collectingStore();
    const result = await runTick(ctx, COLD_CADENCE, store);
    expect(result.anomalies.map((a) => a.kind)).toContain(
      'compliance-deadline-near',
    );
  });
});

describe('detector-registry — unbuilt opportunity detectors stay skipped', () => {
  it('does not register the 3 unbuilt opportunity kinds', () => {
    for (const kind of UNBUILT_OPPORTUNITY_KINDS) {
      expect(OPPORTUNITY_DETECTORS[kind]).toBeUndefined();
    }
  });

  it('runs the cold cadence (which declares unbuilt opportunities) without throwing', async () => {
    const ctx = ctxWith({});
    const { store } = collectingStore();
    const result = await runTick(ctx, COLD_CADENCE, store);
    expect(result.opportunities).toEqual([]);
  });
});
