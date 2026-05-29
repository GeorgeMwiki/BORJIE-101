/**
 * Regulatory zones — TZ PCCB / NEMC / EITI / TMAA boundaries plus,
 * post issue #207 (migration 0144), KE / UG / NG / ZA / AU / CL / ID
 * jurisdiction polygons.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - packages/database/src/migrations/0144_tenant_regulatory_zones.sql
 *   - packages/database/src/migrations/0143_regulator_jurisdictions.sql
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

// Issue #207 WS-8 — the authority list is now extensible per
// jurisdiction. Each row carries the regulator_set + country_code
// columns; the application layer joins to regulator_jurisdictions
// for the human-facing labels.
export const REGULATORY_AUTHORITIES = [
  'pccb',
  'nemc',
  'eiti',
  'tmaa',
  // KE
  'nema-ke',
  // NG
  'nesrea-ng',
  // ZA
  'dmre-za',
  // AU
  'epa-vic-au',
  // CL
  'sernageomin-cl',
  // ID
  'esdm-id',
] as const;
export type RegulatoryAuthority = (typeof REGULATORY_AUTHORITIES)[number];

export const regulatoryZones = pgTable(
  'regulatory_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authority: text('authority').notNull(),
    /**
     * Regulator-set the polygon belongs to. Default 'TZ-set' so legacy
     * 0130 rows stay binary-identical. Joins to
     * regulator_jurisdictions.regulator_set.
     */
    regulatorSet: text('regulator_set').notNull().default('TZ-set'),
    /** ISO-3166-1 alpha-2 (migration 0144 default 'TZ'). */
    countryCode: text('country_code').notNull().default('TZ'),
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
    regulatorSetIdx: index('regulatory_zones_regulator_set_idx').on(
      t.regulatorSet,
    ),
    countryCodeIdx: index('regulatory_zones_country_code_idx').on(
      t.countryCode,
    ),
    setAuthorityCodeUnique: uniqueIndex(
      'regulatory_zones_set_authority_code_unique',
    ).on(t.regulatorSet, t.authority, t.code),
  }),
);

export type RegulatoryZone = typeof regulatoryZones.$inferSelect;
export type NewRegulatoryZone = typeof regulatoryZones.$inferInsert;
