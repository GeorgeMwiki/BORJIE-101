/**
 * Ore-stockpile (warehouse) — types, Zod schemas, row mappers.
 *
 * Split out of `drizzle-ore-warehouse-repository.ts` to keep each
 * file under the project's 300-line soft cap.
 */

import { z } from 'zod';
import {
  ORE_STOCKPILE_LOCATION_KINDS,
  type OreStockpileLocationKind,
} from '@borjie/database';
import type { TenantId, UserId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Domain shape
// ---------------------------------------------------------------------------

export interface OreStockpile {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly parcelId: string;
  readonly siteId: string | null;
  readonly locationKind: OreStockpileLocationKind;
  readonly locationRef: string | null;
  readonly quantityKg: number;
  readonly custodianUserId: UserId | null;
  readonly custodyEventLog: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly storedAt: string;
  readonly lastInspectedAt: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const createStockpileSchema = z.object({
  id: z.string().min(1),
  parcelId: z.string().min(1),
  siteId: z.string().nullable().optional(),
  locationKind: z.enum(ORE_STOCKPILE_LOCATION_KINDS).default('site'),
  locationRef: z.string().nullable().optional(),
  quantityKg: z.number().nonnegative(),
  custodianUserId: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type CreateStockpileInput = z.infer<typeof createStockpileSchema>;

export const recordCustodyTransferSchema = z.object({
  stockpileId: z.string().min(1),
  toUserId: z.string().min(1),
  toLocationKind: z.enum(ORE_STOCKPILE_LOCATION_KINDS),
  toLocationRef: z.string().nullable().optional(),
  fingerprintEventId: z.string().nullable().optional(),
  occurredAt: z.string().optional(),
});
export type RecordCustodyTransferInput = z.infer<
  typeof recordCustodyTransferSchema
>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface OreWarehouseRepository {
  createStockpile(
    tenantId: TenantId,
    input: CreateStockpileInput,
  ): Promise<OreStockpile>;
  findById(
    tenantId: TenantId,
    stockpileId: string,
  ): Promise<OreStockpile | null>;
  listByParcel(
    tenantId: TenantId,
    parcelId: string,
  ): Promise<readonly OreStockpile[]>;
  listByLocation(
    tenantId: TenantId,
    locationKind: OreStockpileLocationKind,
  ): Promise<readonly OreStockpile[]>;
  recordCustodyTransfer(
    tenantId: TenantId,
    input: RecordCustodyTransferInput,
  ): Promise<OreStockpile>;
  recordInspection(
    tenantId: TenantId,
    stockpileId: string,
    inspectionAt?: string,
  ): Promise<OreStockpile>;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? new Date().toISOString());
}

export function rowToStockpile(row: Record<string, unknown>): OreStockpile {
  const kindRaw = String(row.locationKind ?? 'site');
  const locationKind: OreStockpileLocationKind = (
    ORE_STOCKPILE_LOCATION_KINDS as readonly string[]
  ).includes(kindRaw)
    ? (kindRaw as OreStockpileLocationKind)
    : 'site';
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    parcelId: String(row.parcelId),
    siteId: (row.siteId as string | null) ?? null,
    locationKind,
    locationRef: (row.locationRef as string | null) ?? null,
    quantityKg: Number(row.quantityKg ?? 0),
    custodianUserId: (row.custodianUserId as UserId | null) ?? null,
    custodyEventLog: Array.isArray(row.custodyEventLogJsonb)
      ? (row.custodyEventLogJsonb as ReadonlyArray<Record<string, unknown>>)
      : [],
    storedAt: toIso(row.storedAt),
    lastInspectedAt:
      row.lastInspectedAt instanceof Date
        ? row.lastInspectedAt.toISOString()
        : ((row.lastInspectedAt as string | null) ?? null),
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
