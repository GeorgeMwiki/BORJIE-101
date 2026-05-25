/**
 * Geology — drill holes, layers, samples, vein models.
 *
 * Per DATA_MODEL.md §3.2. The geological observation backbone:
 *   - drill_holes / pits / trenches the supervisor digs or drills
 *   - drill_hole_layers — every lithology change down-hole
 *   - samples — lab-bound packets keyed by hole + depth
 *   - vein_models — interpreted resource estimates per site
 *
 * Geometry: PostGIS `geography(POINT, 4326)` for the collar. GeoJSON
 * string at ORM boundary; the migration adds the real geo column.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { sites } from './sites.schema.js';

export const drillHoles = pgTable(
  'drill_holes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Supervisor-readable ID (e.g. "DDH-2026-014"). */
    holeIdExternal: text('hole_id_external').notNull(),
    /** pit|shaft|rc|diamond|hand_augur|trench|channel. */
    kind: text('kind').notNull(),
    /** PostGIS POINT — collar location. GeoJSON string. */
    collarLocation: text('collar_location'),
    azimuthDeg: numeric('azimuth_deg', { precision: 5, scale: 2 }),
    dipDeg: numeric('dip_deg', { precision: 5, scale: 2 }),
    totalDepthM: numeric('total_depth_m', { precision: 8, scale: 2 }),
    supervisorUserId: text('supervisor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('drill_holes_tenant_idx').on(t.tenantId),
    siteIdx: index('drill_holes_site_idx').on(t.siteId),
    kindIdx: index('drill_holes_kind_idx').on(t.tenantId, t.kind),
  }),
);

// ============================================================================
// drill_hole_layers — geological intervals down-hole
// ============================================================================

export const drillHoleLayers = pgTable(
  'drill_hole_layers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    holeId: text('hole_id')
      .notNull()
      .references(() => drillHoles.id, { onDelete: 'cascade' }),
    depthFromM: numeric('depth_from_m', { precision: 8, scale: 2 }).notNull(),
    depthToM: numeric('depth_to_m', { precision: 8, scale: 2 }).notNull(),
    lithology: text('lithology'),
    colour: text('colour'),
    grainSize: text('grain_size'),
    isVeinIntersect: boolean('is_vein_intersect').notNull().default(false),
    veinWidthM: numeric('vein_width_m', { precision: 6, scale: 3 }),
    veinDipDeg: numeric('vein_dip_deg', { precision: 5, scale: 2 }),
    hostRock: text('host_rock'),
    /** visible_au|sulphide|garnet|chrome|quartz|... */
    mineralisationIndicators: text('mineralisation_indicators')
      .array()
      .notNull()
      .default([]),
    photoUrl: text('photo_url'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    holeIdx: index('drill_hole_layers_hole_idx').on(t.holeId),
    tenantIdx: index('drill_hole_layers_tenant_idx').on(t.tenantId),
    veinIdx: index('drill_hole_layers_vein_idx').on(t.tenantId, t.isVeinIntersect),
  }),
);

// ============================================================================
// samples — lab-bound assay packets
// ============================================================================

export const samples = pgTable(
  'samples',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    drillHoleId: text('drill_hole_id').references(() => drillHoles.id, {
      onDelete: 'set null',
    }),
    depthM: numeric('depth_m', { precision: 8, scale: 2 }),
    sampleTag: text('sample_tag').notNull(),
    massG: numeric('mass_g', { precision: 8, scale: 2 }),
    labId: text('lab_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    resultsAt: timestamp('results_at', { withTimezone: true }),
    /** {Au_g_t: 2.4, Cu_pct: 0.6, ...}. */
    results: jsonb('results').notNull().default({}),
    /** standard|blank|duplicate|client. */
    qaQc: jsonb('qa_qc').notNull().default({}),
    passedQaqc: boolean('passed_qaqc'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('samples_tenant_idx').on(t.tenantId),
    holeIdx: index('samples_hole_idx').on(t.drillHoleId),
    tagIdx: index('samples_tag_idx').on(t.tenantId, t.sampleTag),
    qaIdx: index('samples_qa_idx').on(t.tenantId, t.passedQaqc),
  }),
);

// ============================================================================
// vein_models — interpreted resource estimates
// ============================================================================

export const veinModels = pgTable(
  'vein_models',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    lengthM: numeric('length_m', { precision: 10, scale: 2 }),
    widthM: numeric('width_m', { precision: 8, scale: 3 }),
    thicknessTrueM: numeric('thickness_true_m', { precision: 8, scale: 3 }),
    dipDeg: numeric('dip_deg', { precision: 5, scale: 2 }),
    strikeDeg: numeric('strike_deg', { precision: 5, scale: 2 }),
    plungeDeg: numeric('plunge_deg', { precision: 5, scale: 2 }),
    volumeM3: numeric('volume_m3', { precision: 14, scale: 2 }),
    densityTPerM3: numeric('density_t_per_m3', { precision: 5, scale: 2 })
      .notNull()
      .default('2.70'),
    estimatedTonnes: numeric('estimated_tonnes', { precision: 14, scale: 2 }),
    /** {Au_g_t: 2.4, Cu_pct: 0.6, ...}. */
    gradeEstimate: jsonb('grade_estimate').notNull().default({}),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    modelVersion: text('model_version'),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('vein_models_tenant_idx').on(t.tenantId),
    siteIdx: index('vein_models_site_idx').on(t.siteId),
  }),
);

export type DrillHole = typeof drillHoles.$inferSelect;
export type DrillHoleLayer = typeof drillHoleLayers.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type VeinModel = typeof veinModels.$inferSelect;
