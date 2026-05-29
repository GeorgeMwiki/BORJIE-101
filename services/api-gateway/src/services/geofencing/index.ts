/**
 * Geofencing service — public surface.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/workers/geofence-watcher.ts
 *   - services/api-gateway/src/composition/brain-tools/geo-tools.ts
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md
 *
 * Produces a single `GeofencingService` value that the api-gateway
 * composition root wires once and the brain-tool catalog + watcher
 * worker + regulatory route handler all consume.
 *
 * Pure factory — every dependency is injected, so vitest can drive
 * each predicate with an in-memory DB double.
 */

import {
  pointInSite,
  pointInHazard,
  pointInTitle,
  distanceToNearestSite,
  pointInComplianceZone,
  estimateRoute,
  haversineMeters,
  type DbLike,
  type RouteHint,
} from './predicates.js';
import type {
  Point,
  SiteHit,
  HazardHit,
  LicenceHit,
  DistanceHit,
  RegulatoryZoneHit,
  RegulatoryAuthority,
} from './types.js';

export interface GeofencingService {
  pointInSite(tenantId: string, point: Point): Promise<SiteHit | null>;
  pointInHazard(
    tenantId: string,
    point: Point,
    now?: Date,
  ): Promise<ReadonlyArray<HazardHit>>;
  pointInTitle(tenantId: string, point: Point): Promise<LicenceHit | null>;
  distanceToNearestSite(
    tenantId: string,
    point: Point,
    limit?: number,
  ): Promise<ReadonlyArray<DistanceHit>>;
  pointInComplianceZone(
    point: Point,
    authorities?: ReadonlyArray<RegulatoryAuthority>,
  ): Promise<ReadonlyArray<RegulatoryZoneHit>>;
  estimateRoute(from: Point, to: Point, options?: { month?: number }): RouteHint;
  haversineMeters(from: Point, to: Point): number;
}

export interface CreateGeofencingServiceOptions {
  readonly db: DbLike;
}

export function createGeofencingService(
  options: CreateGeofencingServiceOptions,
): GeofencingService {
  const { db } = options;
  return Object.freeze({
    pointInSite(tenantId, point) {
      return pointInSite(db, tenantId, point);
    },
    pointInHazard(tenantId, point, now) {
      return pointInHazard(db, tenantId, point, now);
    },
    pointInTitle(tenantId, point) {
      return pointInTitle(db, tenantId, point);
    },
    distanceToNearestSite(tenantId, point, limit) {
      return distanceToNearestSite(db, tenantId, point, limit);
    },
    pointInComplianceZone(point, authorities) {
      return pointInComplianceZone(db, point, authorities);
    },
    estimateRoute,
    haversineMeters,
  });
}

export {
  pointInSite,
  pointInHazard,
  pointInTitle,
  distanceToNearestSite,
  pointInComplianceZone,
  estimateRoute,
  haversineMeters,
  type DbLike,
  type RouteHint,
} from './predicates.js';

export type {
  Point,
  Fix,
  SiteHit,
  HazardHit,
  LicenceHit,
  DistanceHit,
  RegulatoryZoneHit,
  RegulatoryAuthority,
  HazardSeverity,
  GeofenceAlert,
  WorkerOffsiteAlert,
  WorkerInHazardAlert,
} from './types.js';
