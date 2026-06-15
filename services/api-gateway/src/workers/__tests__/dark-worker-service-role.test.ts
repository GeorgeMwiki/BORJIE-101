/**
 * Dark-worker service-role regression guard.
 *
 * The four out-of-band workers below scan FORCE-RLS tenant-scoped tables
 * CROSS-TENANT over the shared service-role pool. If a worker issues its scan
 * on the bare, un-contextualised db handle, FORCE ROW LEVEL SECURITY silently
 * filters it to ZERO rows (the reminders-class dark-worker bug — migrations
 * 0354 / 0357). Each worker MUST run its scan inside `withServiceRoleContext`,
 * which binds `app.is_service_role='true'`.
 *
 * This test proves, WITHOUT a database, that each worker:
 *   1. enters a transaction (db.transaction is called), AND
 *   2. binds the service-role GUC inside it (a set_config for
 *      `app.is_service_role` runs on the tx), AND
 *   3. never issues a query on the bare db.execute (nothing bypasses the
 *      wrapper).
 *
 * A worker that regresses to a bare `options.db.execute(...)` scan fails (1)+(3)
 * — the precise dark-worker regression. (The end-to-end "returns rows under
 * FORCE RLS" proof lives in the migration-apply / RLS integration lane that
 * runs against a real Postgres.)
 */

import { describe, it, expect, vi } from 'vitest';

import { createIcaCertExpiryCron } from '../ica-cert-expiry-cron.js';
import { createComplianceDeadlineScan } from '../compliance-deadline-scan.worker.js';
import { createGeofenceWatcher } from '../geofence-watcher.js';
import { createEntityIndexerWorker } from '../entity-indexer-worker.js';
// 2026-06-14 live-readiness audit — 4 more cross-tenant service-role workers.
import { createDecisionRetrospectiveWorker } from '../decision-retrospective-worker.js';
import { createOutcomeReconciliationWorker } from '../outcome-reconciliation-worker.js';
import { createExecutiveBriefActionRunner } from '../executive-brief-action-runner.js';
import { startLicenceRenewalWatcher } from '../licence-renewal-watcher.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as never;
}

/** Flatten a drizzle `sql` object to text so we can detect the GUC bind. */
function sqlText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((c) => {
        const v = (c as { value?: unknown }).value;
        if (Array.isArray(v)) return v.join('');
        if (typeof v === 'string') return v;
        return '';
      })
      .join(' ');
  }
  return JSON.stringify(q ?? '');
}

/**
 * Transaction-capable db double. `withServiceRoleContext` binds the GUC via
 * `db.transaction(...)`, so a wrapped worker exercises `transaction` + `tx
 * .execute` and never the bare `execute`.
 */
function makeRecordingDb(scanResult: unknown = { rows: [] }) {
  const txQueries: unknown[] = [];
  const bareExecute = vi.fn(async () => scanResult);
  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => {
          txQueries.push(q);
          return scanResult;
        }),
      };
      return fn(tx);
    },
  );
  return { db: { execute: bareExecute, transaction }, txQueries, bareExecute, transaction };
}

function expectBoundServiceRole(rec: ReturnType<typeof makeRecordingDb>) {
  expect(rec.transaction, 'worker did not enter a transaction').toHaveBeenCalled();
  expect(
    rec.bareExecute,
    'worker issued a query on the bare (un-contextualised) db.execute',
  ).not.toHaveBeenCalled();
  const bound = rec.txQueries.some((q) => sqlText(q).includes('is_service_role'));
  expect(bound, 'worker did not bind app.is_service_role inside its tx').toBe(true);
}

const NOW = new Date('2026-06-14T08:00:00Z');

const geofencingStub = {
  pointInSite: async () => null,
  pointInHazard: async () => [],
  pointInTitle: async () => null,
  distanceToNearestSite: async () => [],
  pointInComplianceZone: async () => [],
  estimateRoute: () => ({
    distanceMeters: 0,
    estimatedMinutes: 0,
    wetSeasonPenalty: 1,
    note: '',
  }),
  haversineMeters: () => 0,
} as never;

describe('dark cross-tenant workers bind service-role context for their scans', () => {
  it('ica-cert-expiry-cron binds service-role for the workforce_certifications scan', async () => {
    const rec = makeRecordingDb();
    const handle = createIcaCertExpiryCron({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('compliance-deadline-scan binds service-role for the regulatory_filings scan', async () => {
    const rec = makeRecordingDb();
    const handle = createComplianceDeadlineScan({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('geofence-watcher binds service-role for the workforce_locations scan', async () => {
    const rec = makeRecordingDb();
    const handle = createGeofenceWatcher({
      db: rec.db as never,
      geofencing: geofencingStub,
      alertSink: { emit: vi.fn() },
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('entity-indexer-worker binds service-role for its source scans', async () => {
    const rec = makeRecordingDb();
    const handle = createEntityIndexerWorker({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
      embedText: async () => null,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('decision-retrospective-worker binds service-role for its pending-grade scan', async () => {
    const rec = makeRecordingDb();
    const handle = createDecisionRetrospectiveWorker({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('outcome-reconciliation-worker binds service-role for its claim scan', async () => {
    const rec = makeRecordingDb();
    const handle = createOutcomeReconciliationWorker({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('executive-brief-action-runner binds service-role for its approved-batch scan', async () => {
    const rec = makeRecordingDb();
    const handle = createExecutiveBriefActionRunner({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });

  it('licence-renewal-watcher binds service-role for its expiry + reminder-event scans', async () => {
    const rec = makeRecordingDb();
    const handle = startLicenceRenewalWatcher({
      db: rec.db as never,
      logger: makeLogger(),
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expectBoundServiceRole(rec);
  });
});
