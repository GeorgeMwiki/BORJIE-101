import { describe, expect, it, vi } from 'vitest';
import type {
  Entity,
  EntityStore,
  EntityWriteInput,
  Recommendation,
  TickContext,
  TickRunResult,
} from '@borjie/proactive-intel';
import { runIntelTick } from '../schedule/intel-tick.js';
import type { TenantDirectory } from '../types.js';

/**
 * Proves `@borjie/proactive-intel` is wired INTO the worker end-to-end:
 *   directory -> runIntelTick iterates tenants/cadences
 *     -> provider supplies a TickContext (cashflow dip)
 *       -> runTick fires the real cashflow-dip detector
 *         -> entity-store persists the anomaly
 *           -> composer -> publisher delivers the recommendation
 */

function directory(tenants: string[]): TenantDirectory {
  return {
    async listActiveTenants() {
      return tenants;
    },
    async listActiveUsers() {
      return [];
    },
  };
}

/** Minimal in-memory entity-store that records writes. */
function recordingStore(writes: EntityWriteInput<string, unknown>[]): EntityStore {
  return {
    async read() {
      return null;
    },
    async write(input) {
      writes.push(input);
      const now = new Date().toISOString();
      return {
        ...input,
        version: 1,
        createdAt: now,
        updatedAt: now,
      } as Entity<string, unknown>;
    },
    async list() {
      return [];
    },
    async delete() {
      // no-op
    },
  };
}

/** A cashflow slice whose p10 dips below the safety floor → fires the detector. */
function dippingTickContext(tenantId: string): TickContext {
  const t0 = Date.UTC(2026, 5, 8);
  const day = 24 * 60 * 60 * 1000;
  return {
    scope: 'tenant',
    tenantId,
    nowMs: t0,
    inputs: {
      cashflow: {
        tenantId,
        safetyFloor: 1_000_000,
        cashBalanceNow: 1_200_000,
        bands: [
          { t: t0, p10: 1_100_000, p50: 1_200_000, p90: 1_300_000 },
          // p10 below floor → dip on day 3.
          { t: t0 + 3 * day, p10: 800_000, p50: 950_000, p90: 1_100_000 },
        ],
      },
    },
  };
}

function fakeRecommendation(tick: TickRunResult): Recommendation {
  const ev = tick.anomalies[0];
  return {
    type: 'anomaly',
    kind: 'cashflow-dip',
    id: `rec:${ev?.id ?? 'x'}`,
    tenantId: tick.tenantId,
    scope: 'tenant',
    confidence: { label: 'high', score: 0.9 },
    severity: 'P1',
    projectedImpactUsdCents: 0,
    suggestedAction: 'Draft an STK push reminder',
    approvalAsk: 'Want me to do it?',
    summary: ev?.headline ?? 'Cash dip detected',
    agUiPart: {
      kind: 'ag-ui.ApprovalDialog.v1',
      title: 'Cashflow dip',
      body: ev?.headline ?? '',
      approveLabel: 'Yes',
      declineLabel: 'No',
      correlationId: ev?.id ?? 'x',
    },
    createdAt: new Date().toISOString(),
    sourceEventId: ev?.id ?? 'x',
  };
}

describe('runIntelTick', () => {
  it('is a clean no-op when no wiring is supplied', async () => {
    const summary = await runIntelTick({
      directory: directory(['t1']),
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(summary.enabled).toBe(false);
    expect(summary.tenantsProcessed).toBe(0);
  });

  it('runs the real detector, persists the anomaly, and publishes a recommendation', async () => {
    const writes: EntityWriteInput<string, unknown>[] = [];
    const published: Recommendation[] = [];

    const summary = await runIntelTick({
      directory: directory(['t1']),
      wiring: {
        store: recordingStore(writes),
        provider: {
          build: (tenantId, tier) =>
            tier === 'hot' ? dippingTickContext(tenantId) : null,
        },
        composer: {
          compose: (_tenantId, tick) =>
            tick.anomalies.length > 0 ? [fakeRecommendation(tick)] : [],
        },
        publisher: {
          publish: (_tenantId, rec) => {
            published.push(rec);
          },
        },
        cadenceTiers: ['hot'],
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.enabled).toBe(true);
    expect(summary.anomaliesDetected).toBeGreaterThanOrEqual(1);
    expect(summary.recommendationsPublished).toBe(1);
    expect(published[0]?.kind).toBe('cashflow-dip');
    // The anomaly was persisted to the entity-store under the intel kind.
    expect(writes.some((w) => w.kind.startsWith('proactive-intel.'))).toBe(true);
  });

  it('records a per-(tenant,cadence) failure and continues', async () => {
    const warn = vi.fn();
    const summary = await runIntelTick({
      directory: directory(['t1']),
      wiring: {
        store: recordingStore([]),
        provider: {
          build: () => {
            throw new Error('input fetch down');
          },
        },
        composer: { compose: () => [] },
        publisher: { publish: () => {} },
        cadenceTiers: ['hot'],
      },
      logger: { info: vi.fn(), warn },
    });
    expect(summary.errored).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});
