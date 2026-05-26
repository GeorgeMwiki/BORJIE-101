/**
 * Commercial junior outputs — asset status, procurement, unit
 * economics, FX snapshots, sales advice, buyer KYC, junior marketplace
 * listings, junior maintenance events. Workforce + safety + community
 * + risk lives in `./workforce-safety.ts`.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
  tenants,
} from './_shared.js';

export const assetStatusSnapshots = pgTable(
  'asset_status_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fleetHealth: text('fleet_health').notNull(),
    utilisationPct: numeric('utilisation_pct', { precision: 5, scale: 2 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('asset_status_snapshots_tenant_idx').on(t.tenantId),
    healthIdx: index('asset_status_snapshots_health_idx').on(t.tenantId, t.fleetHealth),
  }),
);

export const procurementRecommendations = pgTable(
  'procurement_recommendations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_recommendations_tenant_idx').on(t.tenantId),
    siteIdx: index('procurement_recommendations_site_idx').on(t.tenantId, t.siteId),
  }),
);

export const unitEconomicsSnapshots = pgTable(
  'unit_economics_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    period: text('period').notNull(),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('unit_economics_snapshots_tenant_idx').on(t.tenantId),
    periodIdx: index('unit_economics_snapshots_period_idx').on(t.tenantId, t.period),
  }),
);

export const fxSnapshots = pgTable(
  'fx_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    botRateTzsPerUsd: numeric('bot_rate_tzs_per_usd', { precision: 12, scale: 4 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('fx_snapshots_tenant_idx').on(t.tenantId),
    modeIdx: index('fx_snapshots_mode_idx').on(t.tenantId, t.mode),
  }),
);

export const salesAdvice = pgTable(
  'sales_advice',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parcelId: text('parcel_id').notNull(),
    recommendedBuyerId: text('recommended_buyer_id'),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sales_advice_tenant_idx').on(t.tenantId),
    parcelIdx: index('sales_advice_parcel_idx').on(t.tenantId, t.parcelId),
  }),
);

export const buyerKycRecords = pgTable(
  'buyer_kyc_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id').notNull(),
    kycStatus: text('kyc_status').notNull(),
    oecdBand: text('oecd_band'),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('buyer_kyc_records_tenant_idx').on(t.tenantId),
    buyerIdx: index('buyer_kyc_records_buyer_idx').on(t.tenantId, t.buyerId),
    statusIdx: index('buyer_kyc_records_status_idx').on(t.tenantId, t.kycStatus),
  }),
);

export const juniorMarketplaceListings = pgTable(
  'junior_marketplace_listings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    participantKind: text('participant_kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('junior_marketplace_listings_tenant_idx').on(t.tenantId),
    kindIdx: index('junior_marketplace_listings_kind_idx').on(
      t.tenantId,
      t.participantKind,
    ),
  }),
);

export const juniorMaintenanceEvents = pgTable(
  'junior_maintenance_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').notNull(),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('junior_maintenance_events_tenant_idx').on(t.tenantId),
    assetIdx: index('junior_maintenance_events_asset_idx').on(t.tenantId, t.assetId),
  }),
);

export type AssetStatusSnapshot = typeof assetStatusSnapshots.$inferSelect;
export type ProcurementRecommendation = typeof procurementRecommendations.$inferSelect;
export type UnitEconomicsSnapshot = typeof unitEconomicsSnapshots.$inferSelect;
export type FxSnapshot = typeof fxSnapshots.$inferSelect;
export type SalesAdviceRow = typeof salesAdvice.$inferSelect;
export type BuyerKycRecord = typeof buyerKycRecords.$inferSelect;
export type JuniorMarketplaceListing = typeof juniorMarketplaceListings.$inferSelect;
export type JuniorMaintenanceEvent = typeof juniorMaintenanceEvents.$inferSelect;
