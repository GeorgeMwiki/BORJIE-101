/**
 * Regulatory zones — Tanzania PCCB / NEMC / EITI boundaries.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/services/geofencing/regulatory.ts
 *
 * Tenant-AGNOSTIC by design. Regulators publish the same
 * boundaries to every operator — same model as
 * intelligence_corpus_chunks (which also sets tenant_id = NULL).
 *
 * Bilingual sw/en per CLAUDE.md hard rule. polygon_geom is a
 * PostGIS `geography(MULTIPOLYGON, 4326)`; Drizzle exposes the
 * GeoJSON string as `polygon`.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const REGULATORY_AUTHORITIES = ['pccb', 'nemc', 'eiti'] as const;
export type RegulatoryAuthority = (typeof REGULATORY_AUTHORITIES)[number];

export const regulatoryZones = pgTable(
  'regulatory_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authority: text('authority').notNull(),
    nameSw: text('name_sw').notNull(),
    nameEn: text('name_en').notNull(),
    code: text('code').notNull(),
    polygon: text('polygon').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    activeFrom: date('active_from'),
    activeUntil: date('active_until'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    authorityIdx: index('regulatory_zones_authority_idx').on(t.authority),
    authorityCodeUnique: uniqueIndex(
      'regulatory_zones_authority_code_unique',
    ).on(t.authority, t.code),
  }),
);

export type RegulatoryZone = typeof regulatoryZones.$inferSelect;
export type NewRegulatoryZone = typeof regulatoryZones.$inferInsert;
