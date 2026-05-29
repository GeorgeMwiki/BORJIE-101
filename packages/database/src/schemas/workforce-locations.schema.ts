/**
 * Workforce locations — ephemeral GPS trail.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/workers/geofence-watcher.ts
 *
 * Tenant-scoped via RLS FORCE per CLAUDE.md hard rule. Rows TTL'd
 * to 24h via a sweeper cron to limit PDPA exposure — we never keep
 * an indefinite trail. The geofence watcher reads recent rows
 * every 30s to detect off-site / in-hazard workers.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const WORKFORCE_LOCATION_SOURCES = [
  'mobile',
  'kiosk',
  'manual',
  'simulated',
] as const;
export type WorkforceLocationSource = (typeof WORKFORCE_LOCATION_SOURCES)[number];

export const workforceLocations = pgTable(
  'workforce_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    employeeId: text('employee_id').notNull(),
    siteId: text('site_id'),
    lat: numeric('lat', { precision: 10, scale: 7 }).notNull(),
    lon: numeric('lon', { precision: 10, scale: 7 }).notNull(),
    accuracyMeters: numeric('accuracy_meters', { precision: 8, scale: 2 }),
    headingDeg: numeric('heading_deg', { precision: 6, scale: 2 }),
    speedMps: numeric('speed_mps', { precision: 7, scale: 3 }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    source: text('source').notNull().default('mobile'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantEmployeeIdx: index(
      'workforce_locations_tenant_employee_captured_idx',
    ).on(t.tenantId, t.employeeId, t.capturedAt),
    tenantRecentIdx: index('workforce_locations_tenant_recent_idx').on(
      t.tenantId,
      t.capturedAt,
    ),
  }),
);

export type WorkforceLocation = typeof workforceLocations.$inferSelect;
export type NewWorkforceLocation = typeof workforceLocations.$inferInsert;
