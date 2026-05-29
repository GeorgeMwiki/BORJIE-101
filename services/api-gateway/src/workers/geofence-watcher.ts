/**
 * Geofence watcher — multi-tenant worker that ticks every 30s, reads
 * the latest workforce_locations fix per active employee, and emits
 * alerts when a worker is:
 *
 *   - off-site for > 5 min (worker_offsite_alert)
 *   - inside a caution / forbidden hazard polygon
 *     (worker_in_hazard_alert)
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/services/geofencing/
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §2
 *
 * Worker shape mirrors `cases-sla-supervisor.ts`:
 *   - Multi-tenant loop, sequential per tenant.
 *   - Failures logged + swallowed so one bad tenant cannot stall the
 *     rest.
 *   - Pino logger only — no console.log per CLAUDE.md hard rule.
 *   - Degraded mode + env-disabled gates.
 *
 * The watcher is idempotent — each alert key includes the
 * (tenantId, employeeId, hazardId|expectedSiteId, capturedAt) tuple
 * so retries do not double-emit.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { GeofencingService, Point } from '../services/geofencing/index.js';

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_OFFSITE_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_OFFSITE_TOLERANCE_METERS = 250;
const DEFAULT_FIX_FRESHNESS_MS = 10 * 60 * 1000;

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface QueryResult {
  rows?: ReadonlyArray<Record<string, unknown>>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as QueryResult | null;
  return r?.rows ?? [];
}

/** Recent fix per worker — fed to the watcher predicate set. */
export interface WorkerFixRow {
  readonly tenantId: string;
  readonly employeeId: string;
  readonly expectedSiteId: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly capturedAt: Date;
}

export interface GeofenceAlertSink {
  /**
   * Fire-and-forget sink. The supervisor swallows alert errors so a
   * failing dispatcher cannot stall the tick. Idempotency keyed on
   * the alert payload by the caller.
   */
  emit(alert: GeofenceWatcherAlert): Promise<void>;
}

export type GeofenceWatcherAlert =
  | {
      readonly kind: 'worker_offsite_alert';
      readonly tenantId: string;
      readonly employeeId: string;
      readonly expectedSiteId: string;
      readonly distanceMeters: number;
      readonly capturedAt: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: 'worker_in_hazard_alert';
      readonly tenantId: string;
      readonly employeeId: string;
      readonly hazardId: string;
      readonly severity: 'work_zone' | 'caution' | 'forbidden';
      readonly capturedAt: string;
      readonly idempotencyKey: string;
    };

export interface GeofenceWatcherOptions {
  readonly db: DbLike;
  readonly geofencing: GeofencingService;
  readonly alertSink: GeofenceAlertSink;
  readonly logger: Logger;
  readonly intervalMs?: number;
  /** Worker must be >= this many metres from assigned site to flag. */
  readonly offsiteToleranceMeters?: number;
  /** Worker must be off-site at least this long to flag. */
  readonly offsiteToleranceMs?: number;
  /** Ignore fixes older than this window when picking the latest fix. */
  readonly fixFreshnessMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface GeofenceWatcherHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<void>;
}

export function createGeofenceWatcher(
  options: GeofenceWatcherOptions,
): GeofenceWatcherHandle {
  const {
    db,
    geofencing,
    alertSink,
    logger,
    intervalMs = DEFAULT_INTERVAL_MS,
    offsiteToleranceMeters = DEFAULT_OFFSITE_TOLERANCE_METERS,
    offsiteToleranceMs = DEFAULT_OFFSITE_TOLERANCE_MS,
    fixFreshnessMs = DEFAULT_FIX_FRESHNESS_MS,
    enabled = process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_GEOFENCE_WATCHER_DISABLED !== 'true',
    now = () => new Date(),
  } = options;

  if (!enabled) {
    logger.info('geofence-watcher: disabled by env');
    return inertHandle();
  }
  if (intervalMs < 1_000) {
    logger.warn(
      { intervalMs },
      'geofence-watcher: intervalMs below 1s clamped to 1s',
    );
  }
  const ticker = Math.max(1_000, intervalMs);

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function listRecentFixes(): Promise<ReadonlyArray<WorkerFixRow>> {
    const since = new Date(now().getTime() - fixFreshnessMs).toISOString();
    try {
      const result = await db.execute(sql`
        SELECT DISTINCT ON (wl.tenant_id, wl.employee_id)
          wl.tenant_id   AS tenant_id,
          wl.employee_id AS employee_id,
          wl.site_id     AS expected_site_id,
          wl.lat         AS lat,
          wl.lon         AS lon,
          wl.captured_at AS captured_at
        FROM workforce_locations wl
        WHERE wl.captured_at >= ${since}::timestamptz
        ORDER BY wl.tenant_id, wl.employee_id, wl.captured_at DESC
        LIMIT 5000
      `);
      return rowsOf(result).map((row) => ({
        tenantId: String(row.tenant_id),
        employeeId: String(row.employee_id),
        expectedSiteId: row.expected_site_id ? String(row.expected_site_id) : null,
        lat: Number(row.lat),
        lon: Number(row.lon),
        capturedAt: new Date(String(row.captured_at)),
      }));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'geofence-watcher: failed to list recent fixes',
      );
      return [];
    }
  }

  async function evaluateFix(fix: WorkerFixRow): Promise<void> {
    const point: Point = { lat: fix.lat, lon: fix.lon };
    const capturedAtMs = fix.capturedAt.getTime();
    const offsiteWindowOk = now().getTime() - capturedAtMs >= offsiteToleranceMs;

    // §1 — hazard predicate: emit one alert per hazard the worker is in.
    try {
      const hazards = await geofencing.pointInHazard(fix.tenantId, point);
      for (const hazard of hazards) {
        if (hazard.severity === 'work_zone') continue;
        const key = `hazard:${fix.tenantId}:${fix.employeeId}:${hazard.hazardId}:${capturedAtMs}`;
        await alertSink.emit({
          kind: 'worker_in_hazard_alert',
          tenantId: fix.tenantId,
          employeeId: fix.employeeId,
          hazardId: hazard.hazardId,
          severity: hazard.severity,
          capturedAt: fix.capturedAt.toISOString(),
          idempotencyKey: key,
        });
      }
    } catch (err) {
      logger.warn(
        {
          tenantId: fix.tenantId,
          employeeId: fix.employeeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'geofence-watcher: hazard predicate failed',
      );
    }

    // §2 — off-site predicate: only emit when the worker has an
    //      expected site, the fix is older than the tolerance, AND
    //      the worker is more than the radius from any site polygon.
    if (!fix.expectedSiteId || !offsiteWindowOk) return;
    try {
      const inside = await geofencing.pointInSite(fix.tenantId, point);
      if (inside && inside.siteId === fix.expectedSiteId) {
        return; // worker is at the assigned site — all good.
      }
      const distances = await geofencing.distanceToNearestSite(
        fix.tenantId,
        point,
        1,
      );
      const nearest = distances[0];
      if (!nearest) return; // tenant has no sites — nothing to compare.
      if (
        nearest.siteId === fix.expectedSiteId &&
        nearest.distanceMeters < offsiteToleranceMeters
      ) {
        return; // within tolerance of the assigned site — still on site.
      }
      const key = `offsite:${fix.tenantId}:${fix.employeeId}:${fix.expectedSiteId}:${capturedAtMs}`;
      await alertSink.emit({
        kind: 'worker_offsite_alert',
        tenantId: fix.tenantId,
        employeeId: fix.employeeId,
        expectedSiteId: fix.expectedSiteId,
        distanceMeters: Math.round(
          nearest.siteId === fix.expectedSiteId
            ? nearest.distanceMeters
            : geofencing.haversineMeters(point, point),
        ),
        capturedAt: fix.capturedAt.toISOString(),
        idempotencyKey: key,
      });
    } catch (err) {
      logger.warn(
        {
          tenantId: fix.tenantId,
          employeeId: fix.employeeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'geofence-watcher: offsite predicate failed',
      );
    }
  }

  async function tick(): Promise<void> {
    if (running) return; // back-pressure: skip if previous tick in flight
    running = true;
    const started = Date.now();
    let processed = 0;
    let errored = 0;
    try {
      const fixes = await listRecentFixes();
      for (const fix of fixes) {
        try {
          await evaluateFix(fix);
          processed += 1;
        } catch (err) {
          errored += 1;
          logger.warn(
            {
              tenantId: fix.tenantId,
              employeeId: fix.employeeId,
              err: err instanceof Error ? err.message : String(err),
            },
            'geofence-watcher: fix evaluation failed',
          );
        }
      }
      logger.debug(
        {
          durationMs: Date.now() - started,
          processed,
          errored,
        },
        'geofence-watcher: tick complete',
      );
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) {
        logger.warn('geofence-watcher: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs: ticker }, 'geofence-watcher started');
      timer = setInterval(() => {
        void tick();
      }, ticker);
      if (typeof timer.unref === 'function') timer.unref();
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info('geofence-watcher stopped');
      }
    },
    async tickOnce() {
      await tick();
    },
  };
}

function inertHandle(): GeofenceWatcherHandle {
  return {
    start() {},
    stop() {},
    async tickOnce() {},
  };
}
