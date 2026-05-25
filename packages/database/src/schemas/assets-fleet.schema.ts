/**
 * Assets, maintenance events, fuel logs — Borjie mining domain.
 *
 * Per DATA_MODEL.md §3.1. Assets are excavators, compressors, generators,
 * pumps, crushers, trucks, vehicles, drill rigs, tools and PPE. Each
 * asset rolls up cumulative hours, fuel use, and a chronological list of
 * maintenance events.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  boolean,
  jsonb,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { companies } from './companies.schema.js';
import { sites } from './sites.schema.js';

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** excavator|compressor|generator|pump|crusher|truck|vehicle|drill_rig|tool|ppe. */
    kind: text('kind').notNull(),
    make: text('make'),
    model: text('model'),
    year: smallint('year'),
    serialNumber: text('serial_number'),
    /** True if company-owned; false if leased / hired-in. */
    owned: boolean('owned').notNull().default(true),
    currentSiteId: text('current_site_id').references(() => sites.id, {
      onDelete: 'set null',
    }),
    currentOperatorUserId: text('current_operator_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    totalHours: numeric('total_hours', { precision: 10, scale: 1 })
      .notNull()
      .default('0'),
    /** operational|under_maintenance|broken|sold|retired. */
    status: text('status').notNull().default('operational'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('assets_tenant_idx').on(t.tenantId),
    companyIdx: index('assets_company_idx').on(t.companyId),
    siteIdx: index('assets_site_idx').on(t.currentSiteId),
    kindIdx: index('assets_kind_idx').on(t.tenantId, t.kind),
    serialIdx: uniqueIndex('assets_serial_idx').on(t.tenantId, t.serialNumber),
  }),
);

// ============================================================================
// maintenance_events — work / repair / service history
// ============================================================================

export const maintenanceEvents = pgTable(
  'maintenance_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** scheduled_service|repair|inspection|breakdown|overhaul|tyre_change|... */
    kind: text('kind').notNull(),
    /** open|in_progress|completed|cancelled. */
    status: text('status').notNull().default('open'),
    summary: text('summary'),
    /** Total downtime in hours. */
    downtimeHours: numeric('downtime_hours', { precision: 8, scale: 2 }),
    costTzs: numeric('cost_tzs', { precision: 14, scale: 2 }),
    partsUsed: jsonb('parts_used').notNull().default([]),
    performedByUserId: text('performed_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('maintenance_events_tenant_idx').on(t.tenantId),
    assetIdx: index('maintenance_events_asset_idx').on(t.assetId),
    statusIdx: index('maintenance_events_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// fuel_logs — fuel issued or consumed per asset
// ============================================================================

export const fuelLogs = pgTable(
  'fuel_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    logDate: date('log_date').notNull(),
    /** diesel|petrol|lubricant|other. */
    fuelKind: text('fuel_kind').notNull().default('diesel'),
    litres: numeric('litres', { precision: 10, scale: 2 }).notNull(),
    pricePerLitreTzs: numeric('price_per_litre_tzs', {
      precision: 10,
      scale: 2,
    }),
    totalCostTzs: numeric('total_cost_tzs', { precision: 14, scale: 2 }),
    /** Odometer or hour-meter reading at time of issue. */
    meterReading: numeric('meter_reading', { precision: 10, scale: 1 }),
    issuedByUserId: text('issued_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    receivedByUserId: text('received_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('fuel_logs_tenant_idx').on(t.tenantId),
    assetDateIdx: index('fuel_logs_asset_date_idx').on(t.assetId, t.logDate),
    siteDateIdx: index('fuel_logs_site_date_idx').on(t.siteId, t.logDate),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type MaintenanceEvent = typeof maintenanceEvents.$inferSelect;
export type FuelLog = typeof fuelLogs.$inferSelect;
