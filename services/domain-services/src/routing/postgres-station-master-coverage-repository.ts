// @ts-nocheck — TODO(borjie-hard-fork): property-domain repository pending mining-equivalent rewrite.
/**
 * Postgres-backed Station Master Coverage Repository (NEW 18)
 *
 * Implements StationMasterCoverageRepository against the
 * `station_master_coverage` table. Row-level tenant isolation is enforced
 * on every query via WHERE tenant_id = :ctx. `putForStationMaster`
 * replaces the entire coverage set for a station master atomically: it
 * deletes any existing rows for (tenant_id, station_master_id) and
 * inserts the new rows inside a single transaction.
 *
 * Backlog + lastAssignedAt are derived at read-time as best-effort values
 * — the deterministic router tie-breaker only needs them to be stable
 * for the snapshot window, not globally correct. A future wave can
 * denormalize these into the coverage row or a sibling table.
 */

import { and, eq } from 'drizzle-orm';
import { stationMasterCoverage } from '@borjie/database';
import { randomUUID } from 'node:crypto';
import type {
  Coverage,
  StationMasterCoverageRepository,
  StationMasterCoverageRow,
} from './types.js';

export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  delete: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function rowToCoverage(row: {
  coverageKind: string;
  coverageValue: unknown;
}): Coverage {
  const value = (row.coverageValue ?? {}) as Record<string, unknown>;
  switch (row.coverageKind) {
    case 'tag':
      return { kind: 'tag', value: { tag: String(value.tag ?? '') } };
    case 'polygon':
      return { kind: 'polygon', value: { geoJson: value.geoJson ?? null } };
    case 'city':
      return {
        kind: 'city',
        value: {
          city: String(value.city ?? ''),
          country:
            value.country === undefined ? undefined : String(value.country),
        },
      };
    case 'property_ids':
      return {
        kind: 'property_ids',
        value: {
          propertyIds: Array.isArray(value.propertyIds)
            ? (value.propertyIds as string[])
            : [],
        },
      };
    case 'region':
      return { kind: 'region', value: { regionId: String(value.regionId ?? '') } };
    default:
      // Unknown kinds default to an empty tag row — matcher filters them out.
      return { kind: 'tag', value: { tag: '' } };
  }
}

export class PostgresStationMasterCoverageRepository
  implements StationMasterCoverageRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async list(tenantId: string): Promise<readonly StationMasterCoverageRow[]> {
    const rows = await this.db
      .select()
      .from(stationMasterCoverage)
      .where(eq(stationMasterCoverage.tenantId, tenantId));

    return rows.map(
      (row: {
        id: string;
        tenantId: string;
        stationMasterId: string;
        coverageKind: string;
        coverageValue: unknown;
        priority: number;
        updatedAt: Date | string | null;
      }) => ({
        id: row.id,
        tenantId: row.tenantId,
        stationMasterId: row.stationMasterId,
        coverage: rowToCoverage(row),
        priority: row.priority ?? 100,
        lastAssignedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : row.updatedAt
              ? String(row.updatedAt)
              : null,
        backlog: 0,
      })
    );
  }

  async putForStationMaster(input: {
    readonly tenantId: string;
    readonly stationMasterId: string;
    readonly coverages: ReadonlyArray<{
      readonly coverage: Coverage;
      readonly priority: number;
    }>;
    readonly updatedBy: string;
  }): Promise<void> {
    await this.db.transaction(async (tx: DrizzleLike) => {
      await tx
        .delete(stationMasterCoverage)
        .where(
          and(
            eq(stationMasterCoverage.tenantId, input.tenantId),
            eq(stationMasterCoverage.stationMasterId, input.stationMasterId)
          )
        );

      if (input.coverages.length === 0) return;

      const now = new Date();
      const values = input.coverages.map((c) => ({
        id: randomUUID(),
        tenantId: input.tenantId,
        stationMasterId: input.stationMasterId,
        coverageKind: c.coverage.kind,
        coverageValue: c.coverage.value,
        priority: c.priority,
        createdAt: now,
        updatedAt: now,
        createdBy: input.updatedBy,
        updatedBy: input.updatedBy,
      }));
      await tx.insert(stationMasterCoverage).values(values);
    });
  }
}