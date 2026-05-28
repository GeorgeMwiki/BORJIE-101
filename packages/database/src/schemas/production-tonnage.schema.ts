/**
 * Production Tonnage Events — Wave PRODUCTION-CAPTURE.
 *
 * Companion to:
 *   - packages/database/src/migrations/0104_production_capture.sql
 *   - services/api-gateway/src/routes/production/tonnage.hono.ts
 *
 * Distinct from the legacy `production_records` table (migration 0003)
 * which is coarse kg-output. This new table captures supervisor-grade
 * tonnage events with QA sign-off and source attribution (field app,
 * plant scale, manual entry). Surfaced to the chat brain via the
 * tools `mining.production.log_tonnage`, `daily_summary`, `qa_backlog`.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const TONNAGE_SOURCES = [
  'field_app',
  'plant_scale',
  'manual_entry',
] as const;
export type TonnageSource = (typeof TONNAGE_SOURCES)[number];

export const TONNAGE_QA_STATUSES = [
  'pending',
  'passed',
  'rejected',
] as const;
export type TonnageQaStatus = (typeof TONNAGE_QA_STATUSES)[number];

export const productionTonnageEvents = pgTable(
  'production_tonnage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id').notNull(),
    shiftId: uuid('shift_id'),
    recordedById: uuid('recorded_by_id').notNull(),
    oreTonnes: numeric('ore_tonnes', { precision: 12, scale: 3 }).notNull(),
    wasteTonnes: numeric('waste_tonnes', { precision: 12, scale: 3 })
      .notNull()
      .default('0'),
    stripRatio: numeric('strip_ratio', { precision: 8, scale: 3 }),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text('source').notNull(),
    evidencePhotoIds: uuid('evidence_photo_ids')
      .array()
      .notNull()
      .default([]),
    qaStatus: text('qa_status').notNull().default('pending'),
    qaPassedAt: timestamp('qa_passed_at', { withTimezone: true }),
    qaPassedBy: uuid('qa_passed_by'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSiteDayIdx: index('production_tonnage_events_tenant_site_day').on(
      table.tenantId,
      table.siteId,
      table.capturedAt,
    ),
    tenantQaPendingIdx: index(
      'production_tonnage_events_tenant_qa_pending',
    ).on(table.tenantId, table.qaStatus),
  }),
);

export type ProductionTonnageEvent =
  typeof productionTonnageEvents.$inferSelect;
export type NewProductionTonnageEvent =
  typeof productionTonnageEvents.$inferInsert;
