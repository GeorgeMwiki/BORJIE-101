/**
 * Station-Master Router (NEW 18)
 *
 * Deterministic first-line routing for incoming applications / work
 * items. Given an ApplicationLocation + AssetType, returns the matching
 * station master id based on their coverage definitions.
 *
 * Matching rules (in order):
 *   1. Filter coverage rows to those matching the location/tags.
 *   2. Sort by (priority ASC, backlog ASC, lastAssignedAt ASC NULLS FIRST,
 *      stationMasterId ASC) — fully deterministic.
 *   3. Return the top row.
 *
 * R18 / KI-010 — polygon coverage is now supported via a pure-TS
 * ray-cast `pointInPolygon` helper (no external dep) so the router
 * works without GeoNode. Accepts GeoJSON `Polygon` and `MultiPolygon`
 * geometries. When the application has no lat/long, polygon rows
 * remain skipped with a clear reason.
 */

import type {
  ApplicationLocation,
  AssetType,
  Coverage,
  RouteDiagnostics,
  RouteResult,
  StationMasterCoverageRepository,
  StationMasterCoverageRow,
} from './types.js';

export const StationMasterRouterError = {
  NO_MATCH: 'NO_MATCH',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
} as const;

export type StationMasterRouterErrorCode =
  (typeof StationMasterRouterError)[keyof typeof StationMasterRouterError];

export class StationMasterRouterException extends Error {
  constructor(
    public readonly code: StationMasterRouterErrorCode,
    message: string,
    public readonly diagnostics?: RouteDiagnostics
  ) {
    super(message);
    this.name = 'StationMasterRouterException';
  }
}

function normalise(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function matchesLocation(
  coverage: Coverage,
  location: ApplicationLocation
): { matches: boolean; reason: string } {
  switch (coverage.kind) {
    case 'tag': {
      const tag = normalise(coverage.value.tag);
      const appTags = (location.tags ?? []).map(normalise);
      return appTags.includes(tag)
        ? { matches: true, reason: `tag:${tag}` }
        : { matches: false, reason: `tag:${tag} not present` };
    }
    case 'city': {
      const city = normalise(coverage.value.city);
      if (normalise(location.city) === city) {
        return { matches: true, reason: `city:${city}` };
      }
      return { matches: false, reason: `city:${city} mismatch` };
    }
    case 'property_ids': {
      if (!location.propertyId) {
        return { matches: false, reason: 'no propertyId' };
      }
      return coverage.value.propertyIds.includes(location.propertyId)
        ? { matches: true, reason: `propertyId:${location.propertyId}` }
        : { matches: false, reason: `propertyId not in list` };
    }
    case 'region': {
      return normalise(location.regionId) === normalise(coverage.value.regionId)
        ? { matches: true, reason: `region:${coverage.value.regionId}` }
        : { matches: false, reason: 'region mismatch' };
    }
    case 'polygon': {
      // R18 / KI-010 — point-in-polygon via pure-TS ray cast (no deps).
      if (
        typeof location.latitude !== 'number' ||
        typeof location.longitude !== 'number'
      ) {
        return { matches: false, reason: 'polygon needs lat/long' };
      }
      const inside = pointInPolygon(
        [location.longitude, location.latitude],
        coverage.value.geoJson,
      );
      return inside
        ? { matches: true, reason: 'polygon contains point' }
        : { matches: false, reason: 'point outside polygon' };
    }
    default:
      return { matches: false, reason: 'unknown coverage kind' };
  }
}

/**
 * R18 / KI-010 — Ray-cast point-in-polygon test for GeoJSON `Polygon`
 * (single outer ring + optional holes) and `MultiPolygon`. Returns true
 * iff the point is in any polygon's exterior ring AND not in any of
 * that polygon's hole rings.
 *
 * Coordinates are `[longitude, latitude]` per GeoJSON convention.
 *
 * Pure helper — no external deps. Mirrors the
 * `@turf/boolean-point-in-polygon` contract closely enough that we can
 * later swap to it if @turf is added to the bundle.
 */
type Ring = ReadonlyArray<readonly [number, number]>;
type GeoJsonPolygonLike =
  | { readonly type: 'Polygon'; readonly coordinates: ReadonlyArray<Ring> }
  | {
      readonly type: 'MultiPolygon';
      readonly coordinates: ReadonlyArray<ReadonlyArray<Ring>>;
    };

export function pointInPolygon(
  point: readonly [number, number],
  geoJson: unknown,
): boolean {
  if (
    geoJson === null ||
    typeof geoJson !== 'object' ||
    !('type' in geoJson) ||
    !('coordinates' in geoJson)
  ) {
    return false;
  }
  const geom = geoJson as GeoJsonPolygonLike;
  if (geom.type === 'Polygon') {
    return pointInRingsWithHoles(point, geom.coordinates);
  }
  if (geom.type === 'MultiPolygon') {
    for (const polyRings of geom.coordinates) {
      if (pointInRingsWithHoles(point, polyRings)) return true;
    }
    return false;
  }
  return false;
}

function pointInRingsWithHoles(
  point: readonly [number, number],
  rings: ReadonlyArray<Ring>,
): boolean {
  if (rings.length === 0) return false;
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(point, outer)) return false;
  for (const hole of holes) {
    if (pointInRing(point, hole)) return false;
  }
  return true;
}

function pointInRing(
  point: readonly [number, number],
  ring: Ring,
): boolean {
  const [x, y] = point;
  let inside = false;
  // Walk each edge of the ring; flip `inside` on every ray crossing.
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0]!;
    const yi = a[1]!;
    const xj = b[0]!;
    const yj = b[1]!;
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function compareRows(
  a: StationMasterCoverageRow,
  b: StationMasterCoverageRow
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.backlog !== b.backlog) return a.backlog - b.backlog;
  const aTs = a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0;
  const bTs = b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0;
  if (aTs !== bTs) return aTs - bTs;
  return a.stationMasterId.localeCompare(b.stationMasterId);
}

export interface StationMasterRouterDeps {
  readonly repository: StationMasterCoverageRepository;
}

export class StationMasterRouter {
  constructor(private readonly deps: StationMasterRouterDeps) {}

  async routeApplication(input: {
    readonly applicationId: string;
    readonly location: ApplicationLocation;
    readonly assetType: AssetType;
    readonly tenantId: string;
  }): Promise<RouteResult> {
    const rows = await this.deps.repository.list(input.tenantId);
    const scoped = rows.filter((r) => r.tenantId === input.tenantId);

    const considered: string[] = [];
    const skipped: string[] = [];
    const matches: StationMasterCoverageRow[] = [];

    for (const row of scoped) {
      considered.push(row.id);
      const result = matchesLocation(row.coverage, input.location);
      if (result.matches) {
        matches.push(row);
      } else {
        skipped.push(row.id);
      }
    }

    if (matches.length === 0) {
      throw new StationMasterRouterException(
        StationMasterRouterError.NO_MATCH,
        `No station master coverage matched application ${input.applicationId}`,
        {
          consideredCoverageIds: considered,
          skippedCoverageIds: skipped,
          reason: 'no matching coverage rows',
        }
      );
    }

    const sorted = [...matches].sort(compareRows);
    const winner = sorted[0]!;
    const { reason } = matchesLocation(winner.coverage, input.location);

    return {
      stationMasterId: winner.stationMasterId,
      coverageId: winner.id,
      coverageKind: winner.coverage.kind,
      matchReason: reason,
    };
  }
}
