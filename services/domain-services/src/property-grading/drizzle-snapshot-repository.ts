/**
 * Drizzle repository for property-grade snapshots.
 *
 * Persists to the append-only `property_grade_snapshots` table. Reads
 * latest + history via (tenant, property, computedAt DESC).
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { propertyGradeSnapshots } from '@borjie/database';
import type {
  GradeSnapshotRecord,
  PropertyGrade,
  SnapshotRepository,
} from './ports.js';

type DbClient = any;

function rowToRecord(row: any): GradeSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenantId ?? row.tenant_id,
    propertyId: row.propertyId ?? row.property_id,
    grade: (row.grade as PropertyGrade) ?? 'INSUFFICIENT_DATA',
    score: Number(row.score),
    dimensions: (row.dimensions as Record<string, unknown>) ?? {},
    reasons: (row.reasons as string[]) ?? [],
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    computedAt:
      (row.computedAt ?? row.computed_at)?.toISOString?.() ??
      String(row.computedAt ?? row.computed_at),
  };
}

export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: DbClient) {}

  async persist(record: GradeSnapshotRecord): Promise<GradeSnapshotRecord> {
    await this.db.insert(propertyGradeSnapshots).values({
      id: record.id,
      tenantId: record.tenantId,
      propertyId: record.propertyId,
      grade: record.grade,
      score: record.score,
      dimensions: record.dimensions,
      reasons: record.reasons,
      inputs: record.inputs,
      weights: {},
      computedAt: new Date(record.computedAt),
    });
    return record;
  }

  async findLatest(
    tenantId: string,
    propertyId: string,
  ): Promise<GradeSnapshotRecord | null> {
    const rows = await this.db
      .select()
      .from(propertyGradeSnapshots)
      .where(
        and(
          eq(propertyGradeSnapshots.tenantId, tenantId),
          eq(propertyGradeSnapshots.propertyId, propertyId),
        ),
      )
      .orderBy(desc(propertyGradeSnapshots.computedAt))
      .limit(1);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findHistory(
    tenantId: string,
    propertyId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const rows = await this.db
      .select()
      .from(propertyGradeSnapshots)
      .where(
        and(
          eq(propertyGradeSnapshots.tenantId, tenantId),
          eq(propertyGradeSnapshots.propertyId, propertyId),
          gte(propertyGradeSnapshots.computedAt, cutoff),
        ),
      )
      .orderBy(desc(propertyGradeSnapshots.computedAt));
    return rows.map(rowToRecord);
  }

  async findLatestByProperty(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>> {
    const rows = await this.db
      .select()
      .from(propertyGradeSnapshots)
      .where(eq(propertyGradeSnapshots.tenantId, tenantId))
      .orderBy(desc(propertyGradeSnapshots.computedAt))
      .limit(500);
    const seen = new Map<string, GradeSnapshotRecord>();
    for (const row of rows) {
      const rec = rowToRecord(row);
      if (!seen.has(rec.propertyId)) seen.set(rec.propertyId, rec);
    }
    return seen;
  }
}
