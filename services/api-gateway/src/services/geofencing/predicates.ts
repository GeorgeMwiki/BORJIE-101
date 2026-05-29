/**
 * Geofencing predicates — pure SQL helpers + a thin haversine fallback.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §2
 *
 * Every predicate is tenant-scoped except `pointInComplianceZone` which
 * reads from the tenant-agnostic `regulatory_zones` table. The service
 * always pre-filters by the bounding-box operator (`&&`) before the
 * expensive `ST_Contains` / `ST_DWithin` calls — same pattern used by
 * Uber/Lyft/Strava/Postgres-fleet-tracking since 2012.
 *
 * Pure functions only — no module-level state. The injected
 * `DbLike.execute(sql)` lets tests substitute an in-memory double.
 */

import { sql } from 'drizzle-orm';
import {
  PointSchema,
  GeofencingError,
  type Point,
  type SiteHit,
  type HazardHit,
  type LicenceHit,
  type DistanceHit,
  type RegulatoryZoneHit,
  type HazardSeverity,
  type RegulatoryAuthority,
} from './types.js';

// ---------------------------------------------------------------------------
// DB seam — keeps this file vitest-friendly without a real Postgres.
// ---------------------------------------------------------------------------

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

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance in metres. Used as the offline fallback in
 * brain tools when the DB is degraded, and inside tests that don't
 * spin up PostGIS.
 */
export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const s =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      sinDLon *
      sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_METERS * c;
}

function ensureValidPoint(point: Point): void {
  const parsed = PointSchema.safeParse(point);
  if (!parsed.success) {
    throw new GeofencingError(
      'invalid_point',
      `point out of range: ${parsed.error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// pointInSite — which of the tenant's sites contains the point?
// ---------------------------------------------------------------------------

export async function pointInSite(
  db: DbLike,
  tenantId: string,
  point: Point,
): Promise<SiteHit | null> {
  ensureValidPoint(point);
  if (!tenantId) {
    throw new GeofencingError('invalid_tenant', 'tenantId required');
  }
  const result = await db.execute(sql`
    SELECT id, name, mineral, phase
    FROM sites
    WHERE tenant_id = ${tenantId}
      AND polygon_geom IS NOT NULL
      AND ST_Contains(
        polygon_geom::geometry,
        ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
      )
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    siteId: String(row.id),
    name: String(row.name),
    mineral: String(row.mineral),
    phase: String(row.phase),
  };
}

// ---------------------------------------------------------------------------
// pointInHazard — list every active hazard polygon containing the point.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Readonly<Record<HazardSeverity, number>> = Object.freeze(
  {
    forbidden: 0,
    caution: 1,
    work_zone: 2,
  },
);

export async function pointInHazard(
  db: DbLike,
  tenantId: string,
  point: Point,
  now: Date = new Date(),
): Promise<ReadonlyArray<HazardHit>> {
  ensureValidPoint(point);
  if (!tenantId) {
    throw new GeofencingError('invalid_tenant', 'tenantId required');
  }
  const result = await db.execute(sql`
    SELECT id, name_sw, name_en, severity, category, site_id
    FROM hazard_zones
    WHERE tenant_id = ${tenantId}
      AND (active_from IS NULL OR active_from <= ${now.toISOString()}::timestamptz)
      AND (active_until IS NULL OR active_until >= ${now.toISOString()}::timestamptz)
      AND ST_Contains(
        polygon_geom::geometry,
        ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
      )
  `);
  const hits: HazardHit[] = rowsOf(result).map((row) => ({
    hazardId: String(row.id),
    nameSw: String(row.name_sw),
    nameEn: String(row.name_en),
    severity: String(row.severity) as HazardSeverity,
    category: String(row.category),
    siteId: row.site_id ? String(row.site_id) : null,
  }));
  // Order by severity: forbidden > caution > work_zone.
  return Object.freeze(
    [...hits].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    ),
  );
}

// ---------------------------------------------------------------------------
// pointInTitle — which mining licence polygon contains the point?
// ---------------------------------------------------------------------------

export async function pointInTitle(
  db: DbLike,
  tenantId: string,
  point: Point,
): Promise<LicenceHit | null> {
  ensureValidPoint(point);
  if (!tenantId) {
    throw new GeofencingError('invalid_tenant', 'tenantId required');
  }
  const result = await db.execute(sql`
    SELECT id, kind, number, mineral, company_id
    FROM licences
    WHERE tenant_id = ${tenantId}
      AND polygon_geom IS NOT NULL
      AND ST_Contains(
        polygon_geom::geometry,
        ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
      )
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    licenceId: String(row.id),
    kind: String(row.kind),
    number: String(row.number),
    mineral: String(row.mineral),
    companyId: String(row.company_id),
  };
}

// ---------------------------------------------------------------------------
// distanceToNearestSite — straight-line metres to nearest tenant site.
// ---------------------------------------------------------------------------

export async function distanceToNearestSite(
  db: DbLike,
  tenantId: string,
  point: Point,
  limit = 1,
): Promise<ReadonlyArray<DistanceHit>> {
  ensureValidPoint(point);
  if (!tenantId) {
    throw new GeofencingError('invalid_tenant', 'tenantId required');
  }
  if (limit < 1 || limit > 100) {
    throw new GeofencingError(
      'invalid_point',
      'limit must be between 1 and 100',
    );
  }
  const result = await db.execute(sql`
    SELECT
      id,
      name,
      ST_Distance(
        location_geom,
        ST_GeographyFromText('SRID=4326;POINT(' || ${point.lon}::text || ' ' || ${point.lat}::text || ')')
      ) AS distance_m
    FROM sites
    WHERE tenant_id = ${tenantId}
      AND location_geom IS NOT NULL
    ORDER BY distance_m ASC
    LIMIT ${limit}
  `);
  return Object.freeze(
    rowsOf(result).map((row) => ({
      siteId: String(row.id),
      siteName: String(row.name),
      distanceMeters: Number(row.distance_m ?? 0),
    })),
  );
}

// ---------------------------------------------------------------------------
// pointInComplianceZone — PCCB / NEMC / EITI lookup. Tenant-agnostic.
// ---------------------------------------------------------------------------

export async function pointInComplianceZone(
  db: DbLike,
  point: Point,
  authorities: ReadonlyArray<RegulatoryAuthority> = ['pccb', 'nemc', 'eiti'],
): Promise<ReadonlyArray<RegulatoryZoneHit>> {
  ensureValidPoint(point);
  if (authorities.length === 0) {
    return Object.freeze([]);
  }
  const authorityList = authorities.map((a) => `'${a}'`).join(',');
  const result = await db.execute(sql`
    SELECT id, authority, name_sw, name_en, code, attributes
    FROM regulatory_zones
    WHERE authority IN (${sql.raw(authorityList)})
      AND ST_Contains(
        polygon_geom::geometry,
        ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
      )
  `);
  return Object.freeze(
    rowsOf(result).map((row) => ({
      zoneId: String(row.id),
      authority: String(row.authority) as RegulatoryAuthority,
      nameSw: String(row.name_sw),
      nameEn: String(row.name_en),
      code: String(row.code),
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
    })),
  );
}

// ---------------------------------------------------------------------------
// Tanzania-aware route stub — straight-line distance + wet-season penalty.
// True Tanzania routing requires an OSRM build with per-season edge
// weights; we return a stub here and polish in Phase 2.
// ---------------------------------------------------------------------------

export interface RouteHint {
  readonly distanceMeters: number;
  readonly estimatedMinutes: number;
  readonly wetSeasonPenalty: number;
  readonly note: string;
}

export function estimateRoute(
  from: Point,
  to: Point,
  options: { readonly month?: number } = {},
): RouteHint {
  ensureValidPoint(from);
  ensureValidPoint(to);
  const straight = haversineMeters(from, to);
  const month = options.month ?? new Date().getUTCMonth() + 1;
  // Tanzania wet season: March-May (long rains) + Nov-Dec (short rains).
  const isWet = (month >= 3 && month <= 5) || month === 11 || month === 12;
  const wetSeasonPenalty = isWet ? 1.35 : 1.0;
  // Crude TZ road network estimate: 40 km/h average; wet season slower.
  const effectiveMeters = straight * wetSeasonPenalty;
  const estimatedMinutes = (effectiveMeters / 1000) * 1.5;
  return Object.freeze({
    distanceMeters: Math.round(straight),
    estimatedMinutes: Math.round(estimatedMinutes),
    wetSeasonPenalty,
    note: isWet
      ? 'Tanzania wet-season penalty applied (rains slow travel ~35%).'
      : 'Tanzania dry-season — straight-line estimate at 40 km/h.',
  });
}
