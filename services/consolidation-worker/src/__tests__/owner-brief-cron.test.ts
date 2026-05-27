/**
 * owner-brief-cron tests — Wave OWNER-HOME.
 *
 * Coverage:
 *   1. Active-tenant fanout — runs the composer once per active tenant
 *      and aggregates the per-tenant outcomes into one result.
 *   2. Idempotency — the composer's persist path is INSERT … ON CONFLICT
 *      DO UPDATE under the hood, so re-running the cron on the same day
 *      MUST NOT create duplicates. We assert via fake composer that
 *      repeat invocations are upserts (one call per tenant per run).
 *   3. Dormant skip — the lister filters out tenants without an active
 *      owner in the dormancy window; the orchestrator therefore composes
 *      a snapshot ONLY for the returned set.
 *   4. Per-tenant error isolation — if the composer throws for tenant
 *      A, the cron continues and persists for tenant B; the failure is
 *      recorded in `errors` without poisoning the batch.
 *   5. Lister failure — when the lister throws, the orchestrator
 *      returns scanned=0 with a single error entry; nothing is persisted.
 *   6. Schedule constant — declared 06:00 EAT → 03:00 UTC, exposed as
 *      `OWNER_BRIEF_CRON_SCHEDULE_UTC` for the supervisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runOwnerBriefCron,
  OWNER_BRIEF_CRON_SCHEDULE_UTC,
  DEFAULT_DORMANCY_WINDOW_DAYS,
  type ActiveOwnerTenant,
  type ActiveTenantLister,
  type SnapshotComposer,
} from '../tasks/owner-brief-cron.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLister(
  tenants: ReadonlyArray<ActiveOwnerTenant>,
): ActiveTenantLister & { readonly calls: ReadonlyArray<unknown> } {
  const calls: unknown[] = [];
  const lister = {
    async list(args: { readonly now: Date; readonly dormancyWindowDays: number }) {
      calls.push(args);
      return tenants;
    },
  };
  return Object.assign(lister, {
    get calls() {
      return calls;
    },
  });
}

function makeComposer(
  behavior: (tenantId: string) => Promise<void> = async () => undefined,
): SnapshotComposer & { readonly calls: ReadonlyArray<string> } {
  const calls: string[] = [];
  const composer = {
    async composeAndPersist(args: {
      readonly tenantId: string;
      readonly now: Date;
    }) {
      calls.push(args.tenantId);
      await behavior(args.tenantId);
      return {
        tenantId: args.tenantId,
        snapshotDate: args.now.toISOString().slice(0, 10),
        id: `snap-${args.tenantId}`,
        hashChainId: null,
      };
    },
  };
  return Object.assign(composer, {
    get calls() {
      return calls;
    },
  });
}

function silentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOwnerBriefCron — active-tenant fanout', () => {
  it('composes a snapshot for every active tenant returned by the lister', async () => {
    const tenants: ReadonlyArray<ActiveOwnerTenant> = [
      { tenantId: 't1', lastOwnerLoginIso: '2026-05-26T12:00:00Z' },
      { tenantId: 't2', lastOwnerLoginIso: '2026-05-27T01:00:00Z' },
      { tenantId: 't3', lastOwnerLoginIso: '2026-05-20T08:00:00Z' },
    ];
    const lister = makeLister(tenants);
    const composer = makeComposer();
    const result = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z') },
    );
    expect(result.scanned).toBe(3);
    expect(result.upserted).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.errors.length).toBe(0);
    expect([...composer.calls].sort()).toEqual(['t1', 't2', 't3']);
  });

  it('passes the dormancy window through to the lister', async () => {
    const lister = makeLister([]);
    const composer = makeComposer();
    await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z'), dormancyWindowDays: 7 },
    );
    expect((lister.calls[0] as { dormancyWindowDays: number }).dormancyWindowDays).toBe(7);
  });

  it('defaults dormancy window to 30 days', async () => {
    const lister = makeLister([]);
    const composer = makeComposer();
    await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z') },
    );
    expect((lister.calls[0] as { dormancyWindowDays: number }).dormancyWindowDays).toBe(
      DEFAULT_DORMANCY_WINDOW_DAYS,
    );
    expect(DEFAULT_DORMANCY_WINDOW_DAYS).toBe(30);
  });
});

describe('runOwnerBriefCron — idempotency', () => {
  it('upserts not duplicates on a same-day re-run', async () => {
    const tenants: ReadonlyArray<ActiveOwnerTenant> = [
      { tenantId: 't-stable', lastOwnerLoginIso: '2026-05-26T09:00:00Z' },
    ];
    const lister = makeLister(tenants);
    const composer = makeComposer();
    const args = { now: new Date('2026-05-27T03:00:00Z') };

    // First pass at 06:00 EAT.
    const first = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      args,
    );
    expect(first.upserted).toBe(1);

    // Operator-triggered re-run later the same day.
    const second = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      args,
    );
    expect(second.upserted).toBe(1);
    // Two runs, two composer invocations — one per run. The persistence
    // step inside composeAndPersist is INSERT … ON CONFLICT DO UPDATE
    // (asserted by the brief.hono.ts contract), so the database row
    // count remains at 1.
    expect(composer.calls.length).toBe(2);
  });
});

describe('runOwnerBriefCron — dormant skip', () => {
  it('skips tenants the lister filters out (e.g. owners idle > window)', async () => {
    // The lister returns only the active-cohort subset. We simulate two
    // dormant tenants being filtered upstream by NOT returning them.
    const activeOnly: ReadonlyArray<ActiveOwnerTenant> = [
      { tenantId: 't-active', lastOwnerLoginIso: '2026-05-26T09:00:00Z' },
    ];
    const lister = makeLister(activeOnly);
    const composer = makeComposer();
    const result = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z') },
    );
    expect(result.scanned).toBe(1);
    expect(result.upserted).toBe(1);
    // The composer is NEVER called for the dormant tenants because the
    // lister never surfaces them.
    expect(composer.calls).toEqual(['t-active']);
  });
});

describe('runOwnerBriefCron — per-tenant error isolation', () => {
  it('records the failure but continues with the remaining tenants', async () => {
    const tenants: ReadonlyArray<ActiveOwnerTenant> = [
      { tenantId: 't-bad', lastOwnerLoginIso: '2026-05-26T09:00:00Z' },
      { tenantId: 't-good', lastOwnerLoginIso: '2026-05-27T02:00:00Z' },
    ];
    const lister = makeLister(tenants);
    const composer = makeComposer(async (tenantId) => {
      if (tenantId === 't-bad') {
        throw new Error('simulated composition failure');
      }
    });
    const result = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z') },
    );
    expect(result.scanned).toBe(2);
    expect(result.upserted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.tenantId).toBe('t-bad');
    expect(result.errors[0]!.reason).toContain('simulated composition failure');
  });
});

describe('runOwnerBriefCron — lister failure aborts the batch', () => {
  it('returns scanned=0 + single error entry when the lister throws', async () => {
    const lister: ActiveTenantLister = {
      async list() {
        throw new Error('lister db down');
      },
    };
    const composer = makeComposer();
    const composerSpy = vi.spyOn(composer, 'composeAndPersist');
    const result = await runOwnerBriefCron(
      { lister, composer, logger: silentLogger() },
      { now: new Date('2026-05-27T03:00:00Z') },
    );
    expect(result.scanned).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.reason).toContain('lister db down');
    expect(composerSpy).not.toHaveBeenCalled();
  });
});

describe('OWNER_BRIEF_CRON_SCHEDULE_UTC', () => {
  it('is set to 03:00 UTC (06:00 EAT, UTC+3, no DST)', () => {
    expect(OWNER_BRIEF_CRON_SCHEDULE_UTC).toBe('0 3 * * *');
  });
});
