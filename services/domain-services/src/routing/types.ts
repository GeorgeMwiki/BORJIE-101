/**
 * Station-Master Routing Types (NEW 18)
 */

export type CoverageKind = 'tag' | 'polygon' | 'city' | 'property_ids' | 'region';

export interface TagCoverage {
  readonly kind: 'tag';
  readonly value: { readonly tag: string };
}

export interface PolygonCoverage {
  readonly kind: 'polygon';
  // Follow-up KI-010 (#33): enable polygon matching via @googlemaps/js-api-loader
  //   + @turf/boolean-point-in-polygon once GeoNode is live. Today a
  //   polygon-kind row is skipped during matching and logged.
  //   See Docs/KNOWN_ISSUES.md#ki-010.
  readonly value: { readonly geoJson: unknown };
}

export interface CityCoverage {
  readonly kind: 'city';
  readonly value: { readonly city: string; readonly country?: string };
}

export interface PropertyIdsCoverage {
  readonly kind: 'property_ids';
  readonly value: { readonly propertyIds: readonly string[] };
}

export interface RegionCoverage {
  readonly kind: 'region';
  readonly value: { readonly regionId: string };
}

export type Coverage =
  | TagCoverage
  | PolygonCoverage
  | CityCoverage
  | PropertyIdsCoverage
  | RegionCoverage;

export interface StationMasterCoverageRow {
  readonly id: string;
  readonly tenantId: string;
  readonly stationMasterId: string;
  readonly coverage: Coverage;
  readonly priority: number;
  /** ISO datetime of the last application assigned — used for tie-break. */
  readonly lastAssignedAt: string | null;
  /** Current count of open items assigned to this station master. */
  readonly backlog: number;
}

export interface ApplicationLocation {
  readonly city?: string;
  readonly country?: string;
  readonly regionId?: string;
  readonly propertyId?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly tags?: readonly string[];
}

export type AssetType = 'residential' | 'commercial' | 'land' | 'mixed_use';

export interface RouteResult {
  readonly stationMasterId: string;
  readonly coverageId: string;
  readonly coverageKind: CoverageKind;
  readonly matchReason: string;
}

export interface RouteDiagnostics {
  readonly consideredCoverageIds: readonly string[];
  readonly skippedCoverageIds: readonly string[];
  readonly reason: string;
}

export interface WorkerTag {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly tag: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface StationMasterCoverageRepository {
  list(tenantId: string): Promise<readonly StationMasterCoverageRow[]>;
  putForStationMaster(input: {
    readonly tenantId: string;
    readonly stationMasterId: string;
    readonly coverages: ReadonlyArray<{
      readonly coverage: Coverage;
      readonly priority: number;
    }>;
    readonly updatedBy: string;
  }): Promise<void>;
}

export interface WorkerTagRepository {
  listForUser(tenantId: string, userId: string): Promise<readonly WorkerTag[]>;
  add(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly tag: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly createdBy: string;
  }): Promise<WorkerTag>;
  remove(tenantId: string, id: string): Promise<void>;
}
