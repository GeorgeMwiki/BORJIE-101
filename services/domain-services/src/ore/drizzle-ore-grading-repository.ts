/**
 * Drizzle repository for ore-parcel grading snapshots (Borjie mining).
 *
 * Each snapshot captures an immutable point-in-time evaluation of an
 * `ore_parcels` row: headline grade %, processability score,
 * blendability score, best-fit customer kind, plus the underlying assay
 * evidence document IDs and the per-element breakdown.
 *
 * Persists to:
 *   - `ore_parcels`           — the parcel itself (denormalised mass + grade).
 *   - `ore_grade_snapshots`   — append-only history of snapshots.
 *
 * Snapshots are NEVER updated — a re-grade is a fresh insert with a new
 * `id` and `snapshot_at`. The latest row per (tenant, parcel) is the
 * authoritative grade; older rows feed trend dashboards.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { oreGradeSnapshots, oreParcels } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const TARGET_CUSTOMER_KINDS = [
  'trader',
  'smelter',
  'refinery',
  'export_buyer',
  'broker',
] as const;
export type TargetCustomerKind = (typeof TARGET_CUSTOMER_KINDS)[number];

export interface OreGradeSnapshotRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly parcelId: string;
  readonly gradePct: number;
  readonly processability: number;
  readonly blendability: number;
  readonly targetCustomerFit: TargetCustomerKind | null;
  readonly assayEvidenceIds: readonly string[];
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly snapshotAt: string;
  readonly snapshotByModel: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const createSnapshotSchema = z.object({
  id: z.string().min(1),
  parcelId: z.string().min(1),
  gradePct: z.number().min(0).max(100),
  processability: z.number().min(0).max(1),
  blendability: z.number().min(0).max(1),
  targetCustomerFit: z.enum(TARGET_CUSTOMER_KINDS).nullable().optional(),
  assayEvidenceIds: z.array(z.string()).default([]),
  dimensions: z.record(z.string(), z.unknown()).default({}),
  snapshotByModel: z.string().nullable().optional(),
});
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface OreGradingRepository {
  persistSnapshot(
    tenantId: TenantId,
    input: CreateSnapshotInput,
  ): Promise<OreGradeSnapshotRecord>;
  findLatestByParcel(
    tenantId: TenantId,
    parcelId: string,
  ): Promise<OreGradeSnapshotRecord | null>;
  findHistoryByParcel(
    tenantId: TenantId,
    parcelId: string,
    months: number,
  ): Promise<readonly OreGradeSnapshotRecord[]>;
  findLatestByTenant(
    tenantId: TenantId,
    limit?: number,
  ): Promise<ReadonlyMap<string, OreGradeSnapshotRecord>>;
  updateParcelHeadlineGrade(
    tenantId: TenantId,
    parcelId: string,
    headline: Readonly<Record<string, number>>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToRecord(row: Record<string, unknown>): OreGradeSnapshotRecord {
  const fitRaw =
    row.targetCustomerFit == null ? null : String(row.targetCustomerFit);
  const targetCustomerFit: TargetCustomerKind | null =
    fitRaw && (TARGET_CUSTOMER_KINDS as readonly string[]).includes(fitRaw)
      ? (fitRaw as TargetCustomerKind)
      : null;
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    parcelId: String(row.parcelId),
    gradePct: Number(row.gradePct ?? 0),
    processability: Number(row.processability ?? 0),
    blendability: Number(row.blendability ?? 0),
    targetCustomerFit,
    assayEvidenceIds: Array.isArray(row.assayEvidenceIds)
      ? (row.assayEvidenceIds as readonly string[])
      : [],
    dimensions: (row.dimensions as Record<string, unknown>) ?? {},
    snapshotAt:
      row.snapshotAt instanceof Date
        ? row.snapshotAt.toISOString()
        : String(row.snapshotAt ?? new Date().toISOString()),
    snapshotByModel: (row.snapshotByModel as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DrizzleOreGradingRepository implements OreGradingRepository {
  constructor(private readonly db: DrizzleLike) {}

  async persistSnapshot(
    tenantId: TenantId,
    input: CreateSnapshotInput,
  ): Promise<OreGradeSnapshotRecord> {
    const validated = createSnapshotSchema.parse(input);
    const snapshotAt = new Date();
    await this.db.insert(oreGradeSnapshots).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      parcelId: validated.parcelId,
      gradePct: String(validated.gradePct),
      processability: String(validated.processability),
      blendability: String(validated.blendability),
      targetCustomerFit: validated.targetCustomerFit ?? null,
      assayEvidenceIds: validated.assayEvidenceIds,
      dimensions: validated.dimensions,
      snapshotAt,
      snapshotByModel: validated.snapshotByModel ?? null,
    });
    return {
      id: validated.id,
      tenantId,
      parcelId: validated.parcelId,
      gradePct: validated.gradePct,
      processability: validated.processability,
      blendability: validated.blendability,
      targetCustomerFit: validated.targetCustomerFit ?? null,
      assayEvidenceIds: validated.assayEvidenceIds,
      dimensions: validated.dimensions,
      snapshotAt: snapshotAt.toISOString(),
      snapshotByModel: validated.snapshotByModel ?? null,
    };
  }

  async findLatestByParcel(
    tenantId: TenantId,
    parcelId: string,
  ): Promise<OreGradeSnapshotRecord | null> {
    const rows = await this.db
      .select()
      .from(oreGradeSnapshots)
      .where(
        and(
          eq(oreGradeSnapshots.tenantId, tenantId as unknown as string),
          eq(oreGradeSnapshots.parcelId, parcelId),
        ),
      )
      .orderBy(desc(oreGradeSnapshots.snapshotAt))
      .limit(1);
    return rows[0] ? rowToRecord(rows[0] as Record<string, unknown>) : null;
  }

  async findHistoryByParcel(
    tenantId: TenantId,
    parcelId: string,
    months: number,
  ): Promise<readonly OreGradeSnapshotRecord[]> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - Math.max(1, months));
    const rows = await this.db
      .select()
      .from(oreGradeSnapshots)
      .where(
        and(
          eq(oreGradeSnapshots.tenantId, tenantId as unknown as string),
          eq(oreGradeSnapshots.parcelId, parcelId),
          gte(oreGradeSnapshots.snapshotAt, cutoff),
        ),
      )
      .orderBy(desc(oreGradeSnapshots.snapshotAt));
    return (rows as Array<Record<string, unknown>>).map(rowToRecord);
  }

  async findLatestByTenant(
    tenantId: TenantId,
    limit = 500,
  ): Promise<ReadonlyMap<string, OreGradeSnapshotRecord>> {
    const rows = await this.db
      .select()
      .from(oreGradeSnapshots)
      .where(eq(oreGradeSnapshots.tenantId, tenantId as unknown as string))
      .orderBy(desc(oreGradeSnapshots.snapshotAt))
      .limit(limit);
    const seen = new Map<string, OreGradeSnapshotRecord>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const rec = rowToRecord(row);
      if (!seen.has(rec.parcelId)) seen.set(rec.parcelId, rec);
    }
    return seen;
  }

  async updateParcelHeadlineGrade(
    tenantId: TenantId,
    parcelId: string,
    headline: Readonly<Record<string, number>>,
  ): Promise<void> {
    // Denormalise the headline grade map onto `ore_parcels.grade` so
    // marketplace listing widgets don't have to walk the snapshot table
    // for every render. The snapshot table remains the source of truth.
    await this.db
      .update(oreParcels)
      .set({ grade: headline })
      .where(
        and(
          eq(oreParcels.id, parcelId),
          eq(oreParcels.tenantId, tenantId as unknown as string),
        ),
      );
  }
}
