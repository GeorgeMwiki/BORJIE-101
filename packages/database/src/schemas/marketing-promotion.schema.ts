/**
 * Marketing & Promotion persistence (Wave 18P).
 *
 * Companion to docs/DESIGN/MARKETING_PROMOTION_SPEC.md. Drizzle types
 * for the 6 tables created by migration 0021_marketing_promotion.sql:
 *
 *   - campaignRecipes               → versioned recipe registry (global).
 *   - campaignRuns                  → one row per launched campaign.
 *   - campaignAssets                → one row per published asset.
 *   - marketingTelemetryEvents      → impression / click / conversion.
 *   - marketingAbResults            → per-variant Bayesian results.
 *   - marketingComplianceScans      → per-asset compliance scan results.
 *
 * campaignRecipes is global product config — no tenant_id, RLS off.
 * The other five are tenant-scoped via direct tenant_id columns; RLS
 * uses the canonical `app.tenant_id` GUC pattern.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  jsonb,
  uuid,
  numeric,
  primaryKey,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// campaign_recipes — versioned recipe registry (GLOBAL)
// ============================================================================

export const campaignRecipes = pgTable(
  'campaign_recipes',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    status: text('status').notNull(),
    /** 0 | 1 | 2 — see AUTHORITY TIERS in the spec. */
    authorityTier: smallint('authority_tier').notNull(),
    /** mining_owner | mineral_buyer | institutional_investor |
     *  regulator | industry_partner | mining_journalist | general_public. */
    audienceSegments: text('audience_segments').array().notNull().default([]),
    composeFnRef: text('compose_fn_ref').notNull(),
    /** parallel | cascading | staggered. */
    sequencing: text('sequencing').notNull(),
    /** ComplianceContract (claims_must_cite + forbidden + disclaimers + geo). */
    compliance: jsonb('compliance').notNull().default({}),
    /** ReadonlyArray<MetricThreshold>. */
    successMetrics: jsonb('success_metrics').notNull().default([]),
    brand: text('brand').notNull().default('borjie'),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    promotedBy: text('promoted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.version] }),
    statusIdx: index('campaign_recipes_status_idx').on(t.status),
    promotedByIdx: index('campaign_recipes_promoted_by_idx').on(t.promotedBy),
  }),
);

// ============================================================================
// campaign_runs — one row per launched campaign
// ============================================================================

export const campaignRuns = pgTable(
  'campaign_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id').notNull(),
    recipeVersion: integer('recipe_version').notNull(),
    /** draft | pending_approval | publishing | live | paused | completed | aborted. */
    status: text('status').notNull().default('draft'),
    audienceSegment: text('audience_segment'),
    /** owner_explicit | mr_mwikila_proactive. */
    triggeredBy: text('triggered_by').notNull(),
    approvedBy: text('approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    launchedAt: timestamp('launched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recipeFk: foreignKey({
      columns: [t.recipeId, t.recipeVersion],
      foreignColumns: [campaignRecipes.id, campaignRecipes.version],
      name: 'campaign_runs_recipe_fk',
    }),
    tenantStatusIdx: index('campaign_runs_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    recipeIdx: index('campaign_runs_recipe_idx').on(t.recipeId, t.recipeVersion),
    approvedByIdx: index('campaign_runs_approved_by_idx').on(t.approvedBy),
  }),
);

// ============================================================================
// campaign_assets — one row per published asset
// ============================================================================

export const campaignAssets = pgTable(
  'campaign_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => campaignRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    assetClass: text('asset_class').notNull(),
    variantId: text('variant_id').notNull(),
    /** { kind: 'document'|'media'|'marketing', id: uuid }. */
    artifactRef: jsonb('artifact_ref').notNull(),
    /** pending | published | failed | withdrawn. */
    publishState: text('publish_state').notNull().default('pending'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    channelPostId: text('channel_post_id'),
    /** UTM tag bag: utm_source/medium/campaign/content. */
    utmTags: jsonb('utm_tags').notNull().default({}),
    auditHash: text('audit_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index('campaign_assets_run_idx').on(t.runId),
    tenantPublishedIdx: index('campaign_assets_tenant_published_idx').on(
      t.tenantId,
      t.publishedAt,
    ),
    channelIdx: index('campaign_assets_channel_idx').on(
      t.channel,
      t.publishState,
    ),
    auditHashIdx: index('campaign_assets_audit_hash_idx').on(t.auditHash),
    variantIdx: index('campaign_assets_variant_idx').on(t.runId, t.variantId),
  }),
);

// ============================================================================
// marketing_telemetry_events — impression / click / conversion feed
// ============================================================================

export const marketingTelemetryEvents = pgTable(
  'marketing_telemetry_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => campaignAssets.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** impression | click | engagement | conversion | share | comment. */
    eventKind: text('event_kind').notNull(),
    channel: text('channel').notNull(),
    visitorSegment: text('visitor_segment'),
    payload: jsonb('payload').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    assetKindIdx: index('marketing_telemetry_events_asset_kind_idx').on(
      t.assetId,
      t.eventKind,
    ),
    tenantRecordedIdx: index('marketing_telemetry_events_tenant_recorded_idx').on(
      t.tenantId,
      t.recordedAt,
    ),
    kindRecordedIdx: index('marketing_telemetry_events_kind_recorded_idx').on(
      t.eventKind,
      t.recordedAt,
    ),
    channelIdx: index('marketing_telemetry_events_channel_idx').on(
      t.channel,
      t.recordedAt,
    ),
  }),
);

// ============================================================================
// marketing_ab_results — per-variant Bayesian results
// ============================================================================

export const marketingAbResults = pgTable(
  'marketing_ab_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => campaignRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').notNull(),
    samples: integer('samples').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    bayesPosterior: numeric('bayes_posterior', { precision: 5, scale: 4 }),
    isWinner: boolean('is_winner'),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index('marketing_ab_results_run_idx').on(t.runId),
    tenantIdx: index('marketing_ab_results_tenant_idx').on(
      t.tenantId,
      t.computedAt,
    ),
  }),
);

// ============================================================================
// marketing_compliance_scans — per-asset compliance scan results
// ============================================================================

export const marketingComplianceScans = pgTable(
  'marketing_compliance_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => campaignAssets.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Array of { claim, position } for uncited claims. */
    uncitedClaims: jsonb('uncited_claims').notNull().default([]),
    forbiddenPhrasesFound: text('forbidden_phrases_found')
      .array()
      .notNull()
      .default([]),
    missingDisclaimers: text('missing_disclaimers')
      .array()
      .notNull()
      .default([]),
    geoRestrictionFlags: text('geo_restriction_flags')
      .array()
      .notNull()
      .default([]),
    scanPassed: boolean('scan_passed').notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    assetIdx: index('marketing_compliance_scans_asset_idx').on(t.assetId),
    tenantIdx: index('marketing_compliance_scans_tenant_idx').on(
      t.tenantId,
      t.scannedAt,
    ),
  }),
);

// ============================================================================
// Inferred Drizzle types
// ============================================================================

export type CampaignRecipeRow = typeof campaignRecipes.$inferSelect;
export type NewCampaignRecipeRow = typeof campaignRecipes.$inferInsert;
export type CampaignRunRow = typeof campaignRuns.$inferSelect;
export type NewCampaignRunRow = typeof campaignRuns.$inferInsert;
export type CampaignAssetRow = typeof campaignAssets.$inferSelect;
export type NewCampaignAssetRow = typeof campaignAssets.$inferInsert;
export type MarketingTelemetryEventRow =
  typeof marketingTelemetryEvents.$inferSelect;
export type NewMarketingTelemetryEventRow =
  typeof marketingTelemetryEvents.$inferInsert;
export type MarketingAbResultRow = typeof marketingAbResults.$inferSelect;
export type NewMarketingAbResultRow = typeof marketingAbResults.$inferInsert;
export type MarketingComplianceScanRow =
  typeof marketingComplianceScans.$inferSelect;
export type NewMarketingComplianceScanRow =
  typeof marketingComplianceScans.$inferInsert;
