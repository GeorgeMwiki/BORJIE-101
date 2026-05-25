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
 * polygon-kind coverage is skipped — KI-010 tracks wiring once GeoNode is live.
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
    case 'polygon':
      // Follow-up KI-010 (Docs/TODO_BACKLOG.md): wire real geospatial matching once GeoNode is
      //   live. See Docs/KNOWN_ISSUES.md#ki-010.
      return { matches: false, reason: 'polygon matching not yet supported' };
    default:
      return { matches: false, reason: 'unknown coverage kind' };
  }
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
