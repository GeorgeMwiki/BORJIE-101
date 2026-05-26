/**
 * Production + sales — shift reports, production records, ore parcels, sales, buyers.
 *
 * Per DATA_MODEL.md §3.3. The operating-output substrate. A `shift_report`
 * captures one supervisor's shift; `production_records` are granular kg/grade
 * outputs; `ore_parcels` are physical stockpiles of saleable material;
 * `sales` are transactions; `buyers` are KYC'd counterparties.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { sites } from './sites.schema.js';
import { companies } from './companies.schema.js';

export const shiftReports = pgTable(
  'shift_reports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    supervisorUserId: text('supervisor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    shiftDate: date('shift_date').notNull(),
    /** day|night. */
    shiftKind: text('shift_kind').notNull().default('day'),
    workersPresent: smallint('workers_present'),
    /** {asset_id: hours} object. */
    machineHours: jsonb('machine_hours').notNull().default({}),
    fuelLitres: numeric('fuel_litres', { precision: 10, scale: 2 }),
    metresAdvanced: numeric('metres_advanced', { precision: 8, scale: 2 }),
    bcmOverburden: numeric('bcm_overburden', { precision: 12, scale: 2 }),
    romTonnes: numeric('rom_tonnes', { precision: 12, scale: 2 }),
    blastsFired: smallint('blasts_fired').notNull().default(0),
    /** [{code, minutes, description}]. */
    delays: jsonb('delays').notNull().default([]),
    incidents: jsonb('incidents').notNull().default([]),
    photos: text('photos').array().notNull().default([]),
    nextShiftPlan: text('next_shift_plan'),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
    signedOffFingerprintEventId: text('signed_off_fingerprint_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('shift_reports_tenant_idx').on(t.tenantId),
    siteDateIdx: index('shift_reports_site_date_idx').on(t.siteId, t.shiftDate),
    siteShiftIdx: uniqueIndex('shift_reports_site_date_kind_idx').on(
      t.siteId,
      t.shiftDate,
      t.shiftKind,
    ),
  }),
);

// ============================================================================
// production_records — granular production output
// ============================================================================

export const productionRecords = pgTable(
  'production_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** rom|concentrate|dore|gem|crushed|run_of_mine. */
    kind: text('kind').notNull(),
    massKg: numeric('mass_kg', { precision: 12, scale: 3 }),
    /** {Au_g_t, Cu_pct, ...}. */
    grade: jsonb('grade').notNull().default({}),
    recoveryPct: numeric('recovery_pct', { precision: 5, scale: 2 }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('production_records_tenant_idx').on(t.tenantId),
    siteTsIdx: index('production_records_site_ts_idx').on(t.siteId, t.ts),
  }),
);

// ============================================================================
// ore_parcels — physical saleable stockpiles
// ============================================================================

export const oreParcels = pgTable(
  'ore_parcels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    massKg: numeric('mass_kg', { precision: 12, scale: 3 }),
    grade: jsonb('grade').notNull().default({}),
    storageLocation: text('storage_location'),
    /** in_stockpile|in_transit|at_buyer|sold|spoiled. */
    status: text('status').notNull().default('in_stockpile'),
    photos: text('photos').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ore_parcels_tenant_idx').on(t.tenantId),
    siteIdx: index('ore_parcels_site_idx').on(t.siteId),
    statusIdx: index('ore_parcels_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// buyers — KYC'd ore counterparties
// ============================================================================

export const buyers = pgTable(
  'buyers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    companyId: text('company_id').references(() => companies.id, {
      onDelete: 'set null',
    }),
    /** trader|smelter|refinery|export_buyer|bot|broker. */
    kind: text('kind').notNull(),
    country: text('country').notNull().default('TZ'),
    licenceNumber: text('licence_number'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    kycStatus: text('kyc_status').notNull().default('pending'),
    // Buyer financial-profile extensions (added by migration 0005).
    creditLimitTzs: numeric('credit_limit_tzs', { precision: 18, scale: 2 }),
    amlStatus: text('aml_status').notNull().default('unknown'),
    bankingJsonb: jsonb('banking_jsonb').notNull().default({}),
    paymentHistoryJsonb: jsonb('payment_history_jsonb').notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    /**
     * Portal-user binding (migration 0010). Set on KYC submission so
     * the bids route can resolve the calling user → buyer in one
     * query, replacing the contact_name = user_id heuristic. NULL for
     * legacy / platform-level buyers without a portal account.
     */
    linkedUserId: text('linked_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('buyers_tenant_idx').on(t.tenantId),
    kindIdx: index('buyers_kind_idx').on(t.tenantId, t.kind),
    kycIdx: index('buyers_kyc_idx').on(t.tenantId, t.kycStatus),
    linkedUserIdx: index('buyers_linked_user_idx').on(t.linkedUserId),
  }),
);

// ============================================================================
// sales — ore-parcel transactions
// ============================================================================

export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parcelId: text('parcel_id')
      .notNull()
      .references(() => oreParcels.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id').references(() => buyers.id, {
      onDelete: 'set null',
    }),
    /** BoT|MTC|export_direct|trader|domestic|other. */
    route: text('route').notNull().default('trader'),
    weighbridgeDocId: text('weighbridge_doc_id'),
    vehiclePlate: text('vehicle_plate'),
    driverUserId: text('driver_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    grossPriceUsd: numeric('gross_price_usd', { precision: 14, scale: 2 }),
    grossPriceTzs: numeric('gross_price_tzs', { precision: 18, scale: 2 }),
    fxAtSaleTzsPerUsd: numeric('fx_at_sale_tzs_per_usd', {
      precision: 10,
      scale: 4,
    }),
    royaltyPct: numeric('royalty_pct', { precision: 5, scale: 2 }),
    inspectionPct: numeric('inspection_pct', { precision: 5, scale: 2 }),
    vatPct: numeric('vat_pct', { precision: 5, scale: 2 }),
    /** {clearing_fee, levy_LGA, ...}. */
    otherLevies: jsonb('other_levies').notNull().default({}),
    netTzs: numeric('net_tzs', { precision: 18, scale: 2 }),
    paymentStatus: text('payment_status').notNull().default('pending'),
    paymentReceivedAt: timestamp('payment_received_at', { withTimezone: true }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sales_tenant_idx').on(t.tenantId),
    parcelIdx: index('sales_parcel_idx').on(t.parcelId),
    buyerIdx: index('sales_buyer_idx').on(t.buyerId),
    tsIdx: index('sales_tenant_ts_idx').on(t.tenantId, t.ts),
    paymentIdx: index('sales_payment_status_idx').on(t.tenantId, t.paymentStatus),
  }),
);

export type ShiftReport = typeof shiftReports.$inferSelect;
export type ProductionRecord = typeof productionRecords.$inferSelect;
export type OreParcel = typeof oreParcels.$inferSelect;
export type Buyer = typeof buyers.$inferSelect;
export type Sale = typeof sales.$inferSelect;
