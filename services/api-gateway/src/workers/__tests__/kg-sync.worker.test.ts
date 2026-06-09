/**
 * Knowledge-graph sync worker — unit tests for tickOnce + lifecycle (W2d).
 *
 * Verifies:
 *   1. tickOnce walks every active tenant and aggregates the per-tenant
 *      ingest counts (node/edge totals + scanned/ingested tallies).
 *   2. A per-tenant ingest failure is isolated — the loop continues and the
 *      failure is tallied, never thrown.
 *   3. `start()` is a no-op when disabled (so test/CI never auto-ingests),
 *      and `stop()` is idempotent.
 *
 * The active-tenant discovery + per-tenant ingest are injected via the test
 * seams, so no real DB / transaction is needed at the unit layer.
 */

import { describe, it, expect, vi } from 'vitest';
import { createKgSyncWorker } from '../kg-sync.worker.js';

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as any;

const noopDb = { execute: vi.fn(async () => ({ rows: [] })) };

describe('kg-sync worker', () => {
  it('walks every active tenant and aggregates ingest counts', async () => {
    const ingestForTenant = vi.fn(async (tenantId: string) => ({
      tenantId,
      nodes: tenantId === 't-1' ? 5 : 3,
      edges: tenantId === 't-1' ? 2 : 1,
      sources: ['licences'],
      skipped: [],
    }));
    const w = createKgSyncWorker({
      db: noopDb,
      logger: stubLogger,
      enabled: false, // never auto-arm in the test
      listActiveTenants: async () => ['t-1', 't-2'],
      ingestForTenant,
    });

    const res = await w.tickOnce();

    expect(ingestForTenant).toHaveBeenCalledTimes(2);
    expect(ingestForTenant).toHaveBeenCalledWith('t-1');
    expect(ingestForTenant).toHaveBeenCalledWith('t-2');
    expect(res.tenantsScanned).toBe(2);
    expect(res.tenantsIngested).toBe(2);
    expect(res.tenantsFailed).toBe(0);
    expect(res.nodes).toBe(8); // 5 + 3
    expect(res.edges).toBe(3); // 2 + 1
  });

  it('isolates a per-tenant ingest failure and continues the loop', async () => {
    const ingestForTenant = vi.fn(async (tenantId: string) => {
      if (tenantId === 't-bad') throw new Error('boom');
      return {
        tenantId,
        nodes: 4,
        edges: 1,
        sources: ['mining_tasks'],
        skipped: [],
      };
    });
    const w = createKgSyncWorker({
      db: noopDb,
      logger: stubLogger,
      enabled: false,
      listActiveTenants: async () => ['t-ok', 't-bad'],
      ingestForTenant,
    });

    const res = await w.tickOnce();

    expect(res.tenantsScanned).toBe(2);
    expect(res.tenantsIngested).toBe(1);
    expect(res.tenantsFailed).toBe(1);
    expect(res.nodes).toBe(4);
    expect(res.edges).toBe(1);
  });

  it('returns zeros when there are no active tenants', async () => {
    const ingestForTenant = vi.fn();
    const w = createKgSyncWorker({
      db: noopDb,
      logger: stubLogger,
      enabled: false,
      listActiveTenants: async () => [],
      ingestForTenant,
    });

    const res = await w.tickOnce();

    expect(ingestForTenant).not.toHaveBeenCalled();
    expect(res.tenantsScanned).toBe(0);
    expect(res.nodes).toBe(0);
    expect(res.edges).toBe(0);
  });

  it('start() is a no-op when disabled; stop() is idempotent', () => {
    const w = createKgSyncWorker({
      db: noopDb,
      logger: stubLogger,
      enabled: false,
      listActiveTenants: async () => ['t-1'],
      ingestForTenant: vi.fn(),
    });
    // Should not throw and should not arm a timer (no auto-ingest in test).
    expect(() => w.start()).not.toThrow();
    expect(() => {
      w.stop();
      w.stop();
    }).not.toThrow();
  });
});
