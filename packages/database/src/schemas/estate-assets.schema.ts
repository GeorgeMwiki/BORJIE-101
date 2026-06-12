/**
 * Estate Assets — Wave ESTATE-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/assets.hono.ts
 *
 * The consolidated asset register across the estate: mining licences,
 * land, buildings, plant, vehicles, inventory, financial instruments,
 * IP, goodwill, crypto. Each row carries a current valuation and
 * encumbrances jsonb.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const ESTATE_ASSET_CLASSES = [
  'mining_licence',
  'land_parcel',
  'building',
  'plant_equipment',
  'vehicle',
  'inventory',
  'financial_instrument',
  'intellectual_property',
  'goodwill',
  'crypto',
  'other',
] as const;
export type EstateAssetClass = (typeof ESTATE_ASSET_CLASSES)[number];

// Valuation methods. These MUST stay in lockstep with the live DB CHECK
// constraint `estate_assets_valmethod_chk` (migration 0094) — any value the
// route accepts but the CHECK rejects would 23514 on insert. The prior values
// ('cost'/'market'/'income'/'depreciated') did NOT match the CHECK; corrected
// here to the constraint's exact set.
export const ESTATE_VALUATION_METHODS = [
  'book_value',
  'market_value',
  'replacement_cost',
  'appraised',
  'discounted_cash_flow',
  'other',
] as const;
export type EstateValuationMethod =
  (typeof ESTATE_VALUATION_METHODS)[number];

// Back-compat aliases (legacy import names; self-referenced only).
export const ESTATE_ASSET_VALUATION_METHODS = ESTATE_VALUATION_METHODS;
export type EstateAssetValuationMethod = EstateValuationMethod;

export const estateAssets = pgTable(
  'estate_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateEntityId: uuid('estate_entity_id').notNull(),
    /** Coarse-grained taxonomy. */
    assetClass: text('asset_class').notNull(),
    /** Human-readable descriptor. */
    descriptor: text('descriptor').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    acquiredCostTzs: numeric('acquired_cost_tzs', { precision: 20, scale: 2 }),
    currentValueTzs: numeric('current_value_tzs', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    valuationMethod: text('valuation_method').notNull().default('book_value'),
    valuationAt: timestamp('valuation_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    location: text('location'),
    insuredUntil: timestamp('insured_until', { withTimezone: true }),
    /** Liens / pledges / restrictions encumbering this asset. */
    encumbrances: jsonb('encumbrances').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entityIdx: index('idx_estate_assets_entity').on(
      t.tenantId,
      t.estateEntityId,
    ),
    classIdx: index('idx_estate_assets_class').on(t.tenantId, t.assetClass),
    valuationAgeIdx: index('idx_estate_assets_valuation_age').on(t.valuationAt),
  }),
);

export type EstateAssetRow = typeof estateAssets.$inferSelect;
export type EstateAssetInsert = typeof estateAssets.$inferInsert;
