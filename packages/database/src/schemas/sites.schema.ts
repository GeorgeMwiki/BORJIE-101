/**
 * Sites + site sections — Borjie mining domain.
 *
 * Per DATA_MODEL.md §3.1. A `site` is a physical mining location
 * inside a licence area. A site has many `site_sections` (camp, fuel
 * store, magazine, ore stockpile, etc.) each with its own polygon.
 *
 * Geometry columns: PostGIS `geography(POINT|POLYGON, 4326)`. Drizzle
 * exposes them as `text` (GeoJSON); the migration adds the real geo
 * columns + GIST indexes.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { licences } from './licences.schema.js';

export const sites = pgTable(
  'sites',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    licenceId: text('licence_id')
      .notNull()
      .references(() => licences.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Primary mineral targeted at this site. */
    mineral: text('mineral').notNull(),
    /** PostGIS POINT — site centroid. GeoJSON string at ORM boundary. */
    location: text('location'),
    /** PostGIS POLYGON — site boundary. GeoJSON string at ORM boundary. */
    polygon: text('polygon'),
    /**
     * Mining phase ladder (per DATA_MODEL.md):
     * pre_licence|exploration|access_prep|sampling|trenching|shafting|
     * vein_search|confirmation|expansion|extraction|sorting|processing|
     * transport|sale|rehab|renewal_conversion.
     */
    phase: text('phase').notNull().default('pre_licence'),
    managerUserId: text('manager_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 0.00-1.00. Bayesian aggregate of drill/sample evidence. */
    geologyConfidence: numeric('geology_confidence', { precision: 3, scale: 2 })
      .notNull()
      .default('0.10'),
    /** active|paused|abandoned|under_rehab. */
    status: text('status').notNull().default('active'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sites_tenant_idx').on(t.tenantId),
    licenceIdx: index('sites_licence_idx').on(t.licenceId),
    phaseIdx: index('sites_phase_idx').on(t.tenantId, t.phase),
  }),
);

// ============================================================================
// site_sections — functional zones inside a site
// ============================================================================

export const siteSections = pgTable(
  'site_sections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /**
     * start|camp|fuel_store|magazine|ore_stockpile|waste_dump|qc|wash_bay|
     * road|emergency_assembly|env_buffer|rehab_nursery|section_n.
     */
    kind: text('kind').notNull(),
    label: text('label'),
    /** PostGIS POLYGON. GeoJSON string at ORM boundary. */
    polygon: text('polygon'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('site_sections_tenant_idx').on(t.tenantId),
    siteIdx: index('site_sections_site_idx').on(t.siteId),
    kindIdx: index('site_sections_kind_idx').on(t.siteId, t.kind),
  }),
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SiteSection = typeof siteSections.$inferSelect;
