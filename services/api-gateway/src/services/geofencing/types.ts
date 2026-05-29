/**
 * Geofencing service — shared types.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §2
 *
 * The service exposes pure spatial predicates plus stateful event
 * emission for the geofence watcher worker. All predicates are
 * tenant-scoped (except `pointInComplianceZone` which is
 * tenant-agnostic — regulators publish the same boundaries to
 * everyone, same model as intelligence_corpus_chunks).
 *
 * Numeric ranges:
 *   - lat in [-90, 90]
 *   - lon in [-180, 180]
 *   - accuracy / distance metres in [0, +∞)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export const PointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
});
export type Point = z.infer<typeof PointSchema>;

export const FixSchema = PointSchema.extend({
  accuracyMeters: z.number().gte(0).optional(),
  headingDeg: z.number().gte(0).lte(360).optional(),
  speedMps: z.number().gte(0).optional(),
  capturedAt: z.string().datetime().optional(),
});
export type Fix = z.infer<typeof FixSchema>;

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface SiteHit {
  readonly siteId: string;
  readonly name: string;
  readonly mineral: string;
  readonly phase: string;
}

export const HAZARD_SEVERITIES = ['work_zone', 'caution', 'forbidden'] as const;
export type HazardSeverity = (typeof HAZARD_SEVERITIES)[number];

export interface HazardHit {
  readonly hazardId: string;
  readonly nameSw: string;
  readonly nameEn: string;
  readonly severity: HazardSeverity;
  readonly category: string;
  readonly siteId: string | null;
}

export interface LicenceHit {
  readonly licenceId: string;
  readonly kind: string;
  readonly number: string;
  readonly mineral: string;
  readonly companyId: string;
}

export interface DistanceHit {
  readonly siteId: string;
  readonly siteName: string;
  readonly distanceMeters: number;
}

export const REGULATORY_AUTHORITIES = ['pccb', 'nemc', 'eiti'] as const;
export type RegulatoryAuthority = (typeof REGULATORY_AUTHORITIES)[number];

export interface RegulatoryZoneHit {
  readonly zoneId: string;
  readonly authority: RegulatoryAuthority;
  readonly nameSw: string;
  readonly nameEn: string;
  readonly code: string;
  readonly attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Watcher worker event shapes
// ---------------------------------------------------------------------------

export interface WorkerOffsiteAlert {
  readonly kind: 'worker_offsite_alert';
  readonly tenantId: string;
  readonly employeeId: string;
  readonly expectedSiteId: string;
  readonly actualLat: number;
  readonly actualLon: number;
  readonly distanceMeters: number;
  readonly capturedAt: string;
}

export interface WorkerInHazardAlert {
  readonly kind: 'worker_in_hazard_alert';
  readonly tenantId: string;
  readonly employeeId: string;
  readonly hazardId: string;
  readonly severity: HazardSeverity;
  readonly capturedAt: string;
}

export type GeofenceAlert = WorkerOffsiteAlert | WorkerInHazardAlert;

// ---------------------------------------------------------------------------
// Service-level errors
// ---------------------------------------------------------------------------

export class GeofencingError extends Error {
  public readonly code:
    | 'invalid_point'
    | 'invalid_tenant'
    | 'persistence_failed'
    | 'unknown_site';

  constructor(
    code: GeofencingError['code'],
    message: string,
    // TS4115 — `cause` is declared on the global `Error` class in ES2022+
    // libs; the parameter-property shorthand needs an `override` marker.
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GeofencingError';
    this.code = code;
  }
}
