/**
 * Site Field Asset Register — types, enums, Zod schemas.
 *
 * Split out of `postgres-site-far-repository.ts` to keep each file
 * under the project's 300-line soft cap.
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums (mirror the mining-domain `assets` + `maintenance_events` schemas)
// ---------------------------------------------------------------------------

export const ASSET_KINDS = [
  'excavator',
  'compressor',
  'generator',
  'pump',
  'crusher',
  'truck',
  'vehicle',
  'drill_rig',
  'tool',
  'ppe',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = [
  'operational',
  'under_maintenance',
  'broken',
  'sold',
  'retired',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const MAINTENANCE_KINDS = [
  'scheduled_service',
  'repair',
  'inspection',
  'breakdown',
  'overhaul',
  'tyre_change',
  'survey',
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_STATUSES = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface SiteAsset {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly kind: AssetKind;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly serialNumber: string | null;
  readonly owned: boolean;
  readonly currentSiteId: string | null;
  readonly currentOperatorUserId: string | null;
  readonly totalHours: number;
  readonly status: AssetStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MaintenanceLogEntry {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly assetId: string;
  readonly kind: MaintenanceKind;
  readonly status: MaintenanceStatus;
  readonly summary: string | null;
  readonly downtimeHours: number | null;
  readonly costTzs: number | null;
  readonly partsUsed: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly performedByUserId: string | null;
  readonly scheduledFor: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly evidenceIds: readonly string[];
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const registerAssetSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  owned: z.boolean().default(true),
  currentSiteId: z.string().nullable().optional(),
  currentOperatorUserId: z.string().nullable().optional(),
  status: z.enum(ASSET_STATUSES).default('operational'),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type RegisterAssetInput = z.infer<typeof registerAssetSchema>;

export const logMaintenanceEventSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  kind: z.enum(MAINTENANCE_KINDS),
  status: z.enum(MAINTENANCE_STATUSES).default('open'),
  summary: z.string().nullable().optional(),
  downtimeHours: z.number().nonnegative().nullable().optional(),
  costTzs: z.number().nonnegative().nullable().optional(),
  partsUsed: z.array(z.record(z.string(), z.unknown())).default([]),
  performedByUserId: z.string().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type LogMaintenanceEventInput = z.infer<
  typeof logMaintenanceEventSchema
>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface SiteFarRepository {
  registerAsset(
    tenantId: TenantId,
    input: RegisterAssetInput,
  ): Promise<SiteAsset>;
  updateAssetStatus(
    tenantId: TenantId,
    assetId: string,
    status: AssetStatus,
    operatorUserId?: string | null,
  ): Promise<SiteAsset>;
  findAssetById(
    tenantId: TenantId,
    assetId: string,
  ): Promise<SiteAsset | null>;
  listAssetsBySite(
    tenantId: TenantId,
    siteId: string,
  ): Promise<readonly SiteAsset[]>;
  logMaintenanceEvent(
    tenantId: TenantId,
    input: LogMaintenanceEventInput,
  ): Promise<MaintenanceLogEntry>;
  listMaintenanceByAsset(
    tenantId: TenantId,
    assetId: string,
  ): Promise<readonly MaintenanceLogEntry[]>;
  findDueScheduledMaintenance(
    tenantId: TenantId | null,
    cutoffIso: string,
  ): Promise<readonly MaintenanceLogEntry[]>;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? new Date().toISOString());
}

function nullableIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

export function rowToAsset(row: Record<string, unknown>): SiteAsset {
  const kindRaw = String(row.kind ?? 'tool');
  const statusRaw = String(row.status ?? 'operational');
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    companyId: String(row.companyId),
    kind: (ASSET_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as AssetKind)
      : 'tool',
    make: (row.make as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    year: row.year == null ? null : Number(row.year),
    serialNumber: (row.serialNumber as string | null) ?? null,
    owned: Boolean(row.owned ?? true),
    currentSiteId: (row.currentSiteId as string | null) ?? null,
    currentOperatorUserId: (row.currentOperatorUserId as string | null) ?? null,
    totalHours: Number(row.totalHours ?? 0),
    status: (ASSET_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as AssetStatus)
      : 'operational',
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function rowToMaintenance(
  row: Record<string, unknown>,
): MaintenanceLogEntry {
  const kindRaw = String(row.kind ?? 'inspection');
  const statusRaw = String(row.status ?? 'open');
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    assetId: String(row.assetId),
    kind: (MAINTENANCE_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as MaintenanceKind)
      : 'inspection',
    status: (MAINTENANCE_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as MaintenanceStatus)
      : 'open',
    summary: (row.summary as string | null) ?? null,
    downtimeHours:
      row.downtimeHours == null ? null : Number(row.downtimeHours),
    costTzs: row.costTzs == null ? null : Number(row.costTzs),
    partsUsed: Array.isArray(row.partsUsed)
      ? (row.partsUsed as ReadonlyArray<Record<string, unknown>>)
      : [],
    performedByUserId: (row.performedByUserId as string | null) ?? null,
    scheduledFor: nullableIso(row.scheduledFor),
    startedAt: nullableIso(row.startedAt),
    completedAt: nullableIso(row.completedAt),
    evidenceIds: Array.isArray(row.evidenceIds)
      ? (row.evidenceIds as readonly string[])
      : [],
    createdAt: toIso(row.createdAt),
  };
}
