/**
 * Hazard zones — geofenced danger areas per site.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/services/geofencing/
 *   - services/api-gateway/src/workers/geofence-watcher.ts
 *
 * Severity ladder: work_zone (expected work area) → caution (PPE
 * required) → forbidden (trespass = HIGH-severity audit). The
 * geofence watcher emits worker_in_hazard_alert when a worker enters
 * a caution or forbidden polygon during their shift.
 *
 * Tenant-scoped via RLS FORCE per CLAUDE.md hard rule. The
 * polygon_geom column is a PostGIS `geography(POLYGON, 4326)`;
 * Drizzle exposes it as `text` (GeoJSON-string) at the ORM
 * boundary — raw SQL in the geofencing service uses the geometry
 * directly via the GIST index.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const HAZARD_SEVERITIES = ['work_zone', 'caution', 'forbidden'] as const;
export type HazardSeverity = (typeof HAZARD_SEVERITIES)[number];

export const HAZARD_CATEGORIES = [
  'blast_area',
  'ore_pit',
  'fuel_store',
  'magazine',
  'flood_plain',
  'unstable_slope',
  'gas_pocket',
  'env_buffer',
  'custom',
] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

export const hazardZones = pgTable(
  'hazard_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    siteId: text('site_id'),
    /** Swahili-first per CLAUDE.md hard rule. */
    nameSw: text('name_sw').notNull(),
    nameEn: text('name_en').notNull(),
    /** work_zone | caution | forbidden */
    severity: text('severity').notNull(),
    category: text('category').notNull().default('custom'),
    /** GeoJSON polygon (text) at ORM boundary. */
    polygon: text('polygon').notNull(),
    activeFrom: timestamp('active_from', { withTimezone: true }),
    activeUntil: timestamp('active_until', { withTimezone: true }),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('hazard_zones_tenant_idx').on(t.tenantId),
    siteIdx: index('hazard_zones_site_idx').on(t.siteId),
    tenantSeverityActiveIdx: index(
      'hazard_zones_tenant_severity_active_idx',
    ).on(t.tenantId, t.severity, t.activeUntil),
  }),
);

export type HazardZone = typeof hazardZones.$inferSelect;
export type NewHazardZone = typeof hazardZones.$inferInsert;
