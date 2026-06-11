/**
 * Read-only Drizzle table refs for the EXISTING media tables.
 *
 * These mirror `packages/database/drizzle/0020_media_generation.sql`
 * 1:1 so a host can persist engine output into the already-shipped
 * `media_artifacts` / `media_safety_scans` tables WITHOUT this package
 * depending on `@borjie/database` (which is a heavy graph) and WITHOUT
 * adding a migration. The columns + CHECK-constrained value sets below
 * are authoritative against 0020.
 *
 * IMPORTANT: this is a typed reference for inserts only. It defines NO
 * new schema and ships NO migration — migration 0020 remains the source
 * of truth. RLS on these tables is enforced in Postgres via the
 * canonical `app.current_tenant_id` GUC bound by gateway middleware; the
 * engine never bypasses it.
 *
 * @module @borjie/media-engine/persistence/media-schema
 */

import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Produced artefacts (tenant-scoped). Mirrors 0020 `media_artifacts`. */
export const mediaArtifacts = pgTable('media_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  recipeId: text('recipe_id').notNull(),
  recipeVersion: integer('recipe_version').notNull(),
  format: text('format').notNull(),
  storageKey: text('storage_key').notNull(),
  thumbStorageKey: text('thumb_storage_key'),
  checksum: text('checksum').notNull(),
  provenance: jsonb('provenance').notNull(),
  spanCitations: jsonb('span_citations').notNull().default([]),
  auditHash: text('audit_hash').notNull(),
  approvalState: text('approval_state').notNull().default('pending'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  generatedAt: timestamp('generated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Safety-scan ledger (tenant-scoped). Mirrors 0020 `media_safety_scans`. */
export const mediaSafetyScans = pgTable('media_safety_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: uuid('artifact_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  scanner: text('scanner').notNull(),
  nsfwProbability: numeric('nsfw_probability', { precision: 4, scale: 3 }),
  deepfakeProbability: numeric('deepfake_probability', {
    precision: 4,
    scale: 3,
  }),
  brandViolationFlags: text('brand_violation_flags')
    .array()
    .notNull()
    .default([]),
  rawResult: jsonb('raw_result').notNull().default({}),
  scannedAt: timestamp('scanned_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Value sets enforced by 0020 CHECK constraints — re-stated for callers. */
export const MEDIA_ARTIFACT_FORMATS = [
  'image',
  'short_video',
  'lipsync_video',
] as const;

export const MEDIA_APPROVAL_STATES = [
  'pending',
  'approved',
  'rejected',
  'auto_published',
] as const;

export type MediaArtifactRow = typeof mediaArtifacts.$inferSelect;
export type MediaArtifactInsert = typeof mediaArtifacts.$inferInsert;
export type MediaSafetyScanRow = typeof mediaSafetyScans.$inferSelect;
export type MediaSafetyScanInsert = typeof mediaSafetyScans.$inferInsert;
