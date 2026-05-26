/**
 * Ore-parcel grading snapshots — Borjie mining domain.
 *
 * Each row is an immutable point-in-time grading of a stockpile
 * (`ore_parcels.id`). The latest row per (tenant, parcel) is the
 * authoritative grade; earlier rows are kept for trend analysis and
 * dispute resolution.
 *
 * Captures: chemical grade (Au g/t, Cu %, etc.), processability score
 * (how cleanly the ore can be beneficiated), blendability (compatibility
 * with other stockpiles for blending to spec), and `target_customer_fit`
 * (which refinery / smelter category this batch is best suited to).
 * Assay evidence document IDs are tracked as a string array so the
 * snapshot can be re-verified against the source lab certificates.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import { oreParcels } from './production-sales.schema.js';

export const oreGradeSnapshots = pgTable(
  'ore_grade_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parcelId: text('parcel_id')
      .notNull()
      .references(() => oreParcels.id, { onDelete: 'cascade' }),
    /**
     * Headline grade as a percentage 0-100 — the marketable "headline"
     * number (e.g. Cu %, or normalised Au value). The full multi-element
     * assay lives in `dimensions`.
     */
    gradePct: numeric('grade_pct', { precision: 6, scale: 3 }).notNull(),
    /** Processability score 0-1: 1.0 = clean ore, 0.0 = unmineable. */
    processability: numeric('processability', {
      precision: 4,
      scale: 3,
    }).notNull(),
    /**
     * Blendability score 0-1: how easily this parcel can be blended with
     * others to hit a target spec. Higher = more flexible feedstock.
     */
    blendability: numeric('blendability', {
      precision: 4,
      scale: 3,
    }).notNull(),
    /** trader|smelter|refinery|export_buyer — best-fit customer kind. */
    targetCustomerFit: text('target_customer_fit'),
    /**
     * Source assay evidence — document IDs in the `documents` table.
     * Required so the snapshot is auditable: third parties can re-run
     * the grade calculation against the same source certs.
     */
    assayEvidenceIds: text('assay_evidence_ids').array().notNull().default([]),
    /**
     * Detailed dimension breakdown: per-element grades, recovery
     * projections, processing route hints, etc. Free-form jsonb so the
     * scoring algorithm can iterate without a schema migration.
     */
    dimensions: jsonb('dimensions').notNull().default({}),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Optional reference to the model / pipeline that produced the
     * snapshot — e.g. `ore-grading-v2.1`. Used for backfill triage when
     * a model is retired.
     */
    snapshotByModel: text('snapshot_by_model'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ore_grade_snapshots_tenant_idx').on(t.tenantId),
    parcelIdx: index('ore_grade_snapshots_parcel_idx').on(t.parcelId),
    parcelSnapshotIdx: index('ore_grade_snapshots_parcel_snapshot_idx').on(
      t.parcelId,
      t.snapshotAt,
    ),
    targetFitIdx: index('ore_grade_snapshots_target_fit_idx').on(
      t.tenantId,
      t.targetCustomerFit,
    ),
  }),
);

export type OreGradeSnapshot = typeof oreGradeSnapshots.$inferSelect;
export type NewOreGradeSnapshot = typeof oreGradeSnapshots.$inferInsert;
