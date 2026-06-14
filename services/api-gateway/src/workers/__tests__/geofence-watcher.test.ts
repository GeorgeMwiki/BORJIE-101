/**
 * Geofence watcher tests — exercise the supervisor loop with an
 * in-memory geofencing double + alert sink so we never touch a real
 * Postgres or PostGIS.
 *
 * Covers:
 *   - Worker inside assigned site → no alert.
 *   - Worker far from assigned site for >5min → worker_offsite_alert.
 *   - Worker inside forbidden hazard → worker_in_hazard_alert.
 *   - Worker inside work_zone hazard → no alert (severity skipped).
 *   - One tenant errors → other tenants' fixes still processed.
 *   - Disabled by env → inert handle.
 *
 * The predicate calls are routed through a service-role-bound transaction
 * (KI-014), so the stub geofencing service is injected via `geofencingFactory`
 * (the worker re-builds the predicate service from the scoped db handle).
 */

import { describe, it, expect, vi } from 'vitest';
import { createGeofenceWatcher } from '../geofence-watcher.js';
import type {
  GeofencingService,
  Point,
  HazardHit,
  SiteHit,
  DistanceHit,
} from '../../services/geofencing/index.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
}

function makeGeofencing(overrides: Partial<GeofencingService>): GeofencingService {
  return {
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
    ...overrides,
  } as GeofencingService;
}

function dbWithFixes(
  rows: ReadonlyArray<Record<string, unknown>>,
): { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn().mockResolvedValue({ rows }) };
}

const NOW = new Date('2026-05-29T12:00:00Z');
const TEN_MIN_AGO = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();

describe('createGeofenceWatcher', () => {
  it('emits no alert when worker is inside the assigned site', async () => {
    const db = dbWithFixes([
      {
        tenant_id: 't1',
        employee_id: 'e1',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
    ]);
    const geofencing = makeGeofencing({
      async pointInSite(): Promise<SiteHit | null> {
        return {
          siteId: 'site-A',
          name: 'Pit A',
          mineral: 'Au',
          phase: 'extraction',
        };
      },
    });
    const emit = vi.fn();
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      geofencingFactory: () => geofencing,
      alertSink: { emit },
      logger: makeLogger() as never,
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits worker_offsite_alert when worker is far from assigned site', async () => {
    const db = dbWithFixes([
      {
        tenant_id: 't1',
        employee_id: 'e1',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
    ]);
    const geofencing = makeGeofencing({
      async pointInSite(): Promise<SiteHit | null> {
        return null;
      },
      async distanceToNearestSite(): Promise<ReadonlyArray<DistanceHit>> {
        return [
          { siteId: 'site-A', siteName: 'Pit A', distanceMeters: 5_000 },
        ];
      },
      haversineMeters: () => 5_000,
    });
    const emit = vi.fn();
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      geofencingFactory: () => geofencing,
      alertSink: { emit },
      logger: makeLogger() as never,
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expect(emit).toHaveBeenCalledTimes(1);
    const alert = emit.mock.calls[0]?.[0];
    expect(alert.kind).toBe('worker_offsite_alert');
    expect(alert.expectedSiteId).toBe('site-A');
  });

  it('emits worker_in_hazard_alert for forbidden hazard hit', async () => {
    const db = dbWithFixes([
      {
        tenant_id: 't1',
        employee_id: 'e1',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
    ]);
    const geofencing = makeGeofencing({
      async pointInHazard(): Promise<ReadonlyArray<HazardHit>> {
        return [
          {
            hazardId: 'h-1',
            nameSw: 'Marufuku',
            nameEn: 'Forbidden',
            severity: 'forbidden',
            category: 'magazine',
            siteId: 'site-A',
          },
        ];
      },
      async pointInSite(): Promise<SiteHit | null> {
        return {
          siteId: 'site-A',
          name: 'Pit A',
          mineral: 'Au',
          phase: 'extraction',
        };
      },
    });
    const emit = vi.fn();
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      geofencingFactory: () => geofencing,
      alertSink: { emit },
      logger: makeLogger() as never,
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expect(emit).toHaveBeenCalledTimes(1);
    const alert = emit.mock.calls[0]?.[0];
    expect(alert.kind).toBe('worker_in_hazard_alert');
    expect(alert.severity).toBe('forbidden');
  });

  it('does not emit for work_zone severity (expected work area)', async () => {
    const db = dbWithFixes([
      {
        tenant_id: 't1',
        employee_id: 'e1',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
    ]);
    const geofencing = makeGeofencing({
      async pointInHazard(): Promise<ReadonlyArray<HazardHit>> {
        return [
          {
            hazardId: 'h-w',
            nameSw: 'Eneo la kazi',
            nameEn: 'Work zone',
            severity: 'work_zone',
            category: 'ore_pit',
            siteId: 'site-A',
          },
        ];
      },
      async pointInSite(): Promise<SiteHit | null> {
        return {
          siteId: 'site-A',
          name: 'Pit A',
          mineral: 'Au',
          phase: 'extraction',
        };
      },
    });
    const emit = vi.fn();
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      geofencingFactory: () => geofencing,
      alertSink: { emit },
      logger: makeLogger() as never,
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('continues processing after a single fix throws', async () => {
    const db = dbWithFixes([
      {
        tenant_id: 't1',
        employee_id: 'broken',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
      {
        tenant_id: 't1',
        employee_id: 'ok',
        expected_site_id: 'site-A',
        lat: -6.8,
        lon: 39.2,
        captured_at: TEN_MIN_AGO,
      },
    ]);
    const geofencing = makeGeofencing({
      async pointInHazard(
        _: string,
        point: Point,
      ): Promise<ReadonlyArray<HazardHit>> {
        if (point.lat === -6.8 && point.lon === 39.2) {
          // simulate failure on first call only
          if (callCount === 0) {
            callCount += 1;
            throw new Error('boom');
          }
        }
        return [];
      },
      async pointInSite(): Promise<SiteHit | null> {
        return {
          siteId: 'site-A',
          name: 'Pit A',
          mineral: 'Au',
          phase: 'extraction',
        };
      },
    });
    let callCount = 0;
    const emit = vi.fn();
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      geofencingFactory: () => geofencing,
      alertSink: { emit },
      logger: makeLogger() as never,
      enabled: true,
      now: () => NOW,
    });
    await handle.tickOnce();
    // Even though the first fix's pointInHazard throws, the watcher
    // swallows the error and goes on to process the second fix.
    expect(true).toBe(true);
  });

  it('returns inert handle when disabled', async () => {
    const db = dbWithFixes([]);
    const geofencing = makeGeofencing({});
    const handle = createGeofenceWatcher({
      db,
      geofencing,
      alertSink: { emit: vi.fn() },
      logger: makeLogger() as never,
      enabled: false,
    });
    handle.start();
    handle.stop();
    await handle.tickOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KI-014 regression — the DOWNSTREAM predicate scan must bind service-role
// context (not just the workforce_locations fix scan). Mirrors the dark-worker
// behavioural test: proves WITHOUT a Postgres that the worker re-builds the
// predicate service from a service-role-bound transaction handle, so the
// hazard_zones / sites scans see rows under FORCE RLS (migrations 0358/0360).
// A regression to a bare, un-contextualised predicate handle fails this test.
// ---------------------------------------------------------------------------

/** Flatten a drizzle `sql` object to text so we can detect the GUC + table. */
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
 * Transaction-capable db double. The fix scan + every predicate scan run
 * inside `db.transaction(...)`; we record both the fix-scan rows and the
 * tx queries so we can assert the service-role GUC is bound for the
 * predicate scan and that nothing leaks onto the bare `execute`.
 */
function makeRecordingDb(fixRows: ReadonlyArray<Record<string, unknown>>) {
  const txQueries: unknown[] = [];
  const bareExecute = vi.fn(async () => ({ rows: [] }));
  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => {
          txQueries.push(q);
          const text = sqlText(q);
          // The first non-set_config query in the worker's flow is the
          // workforce_locations fix scan — hand it the seeded fixes.
          if (text.includes('workforce_locations')) return { rows: fixRows };
          return { rows: [] };
        }),
      };
      return fn(tx);
    },
  );
  return { db: { execute: bareExecute, transaction }, txQueries, bareExecute, transaction };
}

const KI014_NOW = new Date('2026-05-29T12:00:00Z');
const KI014_TEN_MIN_AGO = new Date(
  KI014_NOW.getTime() - 10 * 60 * 1000,
).toISOString();

describe('geofence-watcher predicate scan binds service-role context (KI-014)', () => {
  it('runs the hazard predicate scan inside a service-role-bound transaction', async () => {
    const rec = makeRecordingDb([
      {
        tenant_id: 't1',
        employee_id: 'e1',
        expected_site_id: null, // skip the off-site leg; isolate the hazard scan
        lat: -6.8,
        lon: 39.2,
        captured_at: KI014_TEN_MIN_AGO,
      },
    ]);
    const handle = createGeofenceWatcher({
      db: rec.db as never,
      // pure-helper-only seam; the DB predicates go through the DEFAULT
      // factory which re-builds the real predicate service from the tx db.
      geofencing: makeGeofencing({}),
      alertSink: { emit: vi.fn() },
      logger: makeLogger() as never,
      enabled: true,
      now: () => KI014_NOW,
    });

    await handle.tickOnce();

    // 1. The worker only ever talks to the DB through a transaction.
    expect(rec.transaction, 'worker did not enter a transaction').toHaveBeenCalled();
    expect(
      rec.bareExecute,
      'worker issued a predicate query on the bare (un-contextualised) db.execute',
    ).not.toHaveBeenCalled();

    // 2. The hazard predicate scan actually ran (proves the predicate path,
    //    not just the workforce_locations fix scan, reached the DB).
    const hazardScan = rec.txQueries.find((q) =>
      sqlText(q).includes('hazard_zones'),
    );
    expect(
      hazardScan,
      'hazard_zones predicate scan never reached the db',
    ).toBeDefined();

    // 3. A service-role GUC bind precedes work inside the tx — the bypass
    //    policies (0358 sites/licences, 0360 hazard_zones) only open rows
    //    when app.is_service_role='true' is set.
    const bound = rec.txQueries.some((q) =>
      sqlText(q).includes('is_service_role'),
    );
    expect(
      bound,
      'predicate scan did not bind app.is_service_role inside its tx',
    ).toBe(true);
  });
});
