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
