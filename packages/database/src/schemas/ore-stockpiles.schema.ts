/**
 * Ore stockpiles — Borjie mining domain.
 *
 * Each row represents a physical accumulation of ore (parcel) sitting
 * in a known custody location: on-site stockpile, external warehouse,
 * or in transit between the two. The chain of custody is recorded via
 * `custodian_user_id` + `custody_event_log_jsonb`, an append-only audit
 * trail kept inline with the row.
 *
 *   site         — at the originating mine site (e.g. behind the wash bay).
 *   warehouse    — at an external warehouse (e.g. Dar es Salaam yard).
 *   in_transit   — moving between the two (truck on the road).
 *
 * Mass is denormalised onto the stockpile row as `quantity_kg` so
 * portfolio dashboards don't need to walk every grade-snapshot row.
 * The canonical mass still lives on `ore_parcels.mass_kg`.
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
import { sites } from './sites.schema.js';
import { oreParcels } from './production-sales.schema.js';

export const oreStockpiles = pgTable(
  'ore_stockpiles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parcelId: text('parcel_id')
      .notNull()
      .references(() => oreParcels.id, { onDelete: 'cascade' }),
    /**
     * The originating site, even for in-transit / external warehouse
     * rows. NULL only when the parcel pre-dates the site model.
     */
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** site|warehouse|in_transit. */
    locationKind: text('location_kind').notNull().default('site'),
    /**
     * Free-form location reference — e.g. the site_section id, the
     * warehouse code, or the truck plate. Interpreted in conjunction
     * with `location_kind`.
     */
    locationRef: text('location_ref'),
    /** Current quantity at this location in kg. */
    quantityKg: numeric('quantity_kg', { precision: 12, scale: 3 }).notNull(),
    /** Current custodian (e.g. site supervisor, warehouseman, driver). */
    custodianUserId: text('custodian_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Append-only custody chain: each entry is
     * `{ ts, fromUserId, toUserId, fromLocationKind, fromLocationRef,
     *    toLocationKind, toLocationRef, fingerprintEventId }`.
     * The current row state is the projection of the latest entry.
     */
    custodyEventLogJsonb: jsonb('custody_event_log_jsonb')
      .notNull()
      .default([]),
    storedAt: timestamp('stored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastInspectedAt: timestamp('last_inspected_at', { withTimezone: true }),
    /** Free-form attributes (tarp condition, security camera link, etc.). */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ore_stockpiles_tenant_idx').on(t.tenantId),
    parcelIdx: index('ore_stockpiles_parcel_idx').on(t.parcelId),
    siteIdx: index('ore_stockpiles_site_idx').on(t.siteId),
    locationKindIdx: index('ore_stockpiles_location_kind_idx').on(
      t.tenantId,
      t.locationKind,
    ),
    custodianIdx: index('ore_stockpiles_custodian_idx').on(t.custodianUserId),
  }),
);

// ============================================================================
// Enum helpers
// ============================================================================

export const ORE_STOCKPILE_LOCATION_KINDS = [
  'site',
  'warehouse',
  'in_transit',
] as const;
export type OreStockpileLocationKind =
  (typeof ORE_STOCKPILE_LOCATION_KINDS)[number];

export type OreStockpile = typeof oreStockpiles.$inferSelect;
export type NewOreStockpile = typeof oreStockpiles.$inferInsert;
