/**
 * Buyer-initiated Request for Bids — R11.
 *
 * Backing migration: `0127_request_for_bids.sql`.
 *
 * A buyer posts "I want N tonnes of X at TZS Y per unit by D". The
 * row is visible to sellers within `radius_km` of the buyer's location
 * via the nearby feed; sellers respond via `request_for_bid_responses`.
 *
 * Tenant scope: RLS FORCE per CLAUDE.md hard rule. Handlers MUST NOT
 * double-filter — the api-gateway database middleware binds
 * `app.current_tenant_id` on every authenticated request.
 *
 * Lifecycle: open → filled | expired | cancelled.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  date,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const requestForBids = pgTable(
  'request_for_bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    buyerId: text('buyer_id').notNull(),
    /** Free-text mineral kind; enum is enforced at the zod schema. */
    mineralKind: text('mineral_kind').notNull(),
    /** Optional minimum grade requirement (e.g. "Au 22 carat"). */
    gradeMin: text('grade_min'),
    /** Lower tonnage requirement — buyer's hard floor. */
    tonnageMin: numeric('tonnage_min', { precision: 10, scale: 3 }).notNull(),
    /** Optional ceiling. NULL means "no max". */
    tonnageMax: numeric('tonnage_max', { precision: 10, scale: 3 }),
    /** Buyer's unit price ceiling in TZS per unit (kg / oz / tonne). */
    unitPriceTzs: numeric('unit_price_tzs', { precision: 15, scale: 2 }).notNull(),
    /** Required-by date — sellers MUST be able to deliver by this. */
    deliveryBy: date('delivery_by').notNull(),
    locationLat: numeric('location_lat', { precision: 9, scale: 6 }),
    locationLon: numeric('location_lon', { precision: 9, scale: 6 }),
    /** Search radius in km. Default 200, max 5000. */
    radiusKm: integer('radius_km').notNull().default(200),
    /** open | filled | expired | cancelled */
    status: text('status').notNull().default('open'),
    notes: text('notes'),
    /** Chat-as-OS provenance — via=chat|buyer_mobile|operator. */
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** RFB auto-expires after 14 days unless filled/cancelled. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tenantStatusMineralIdx: index(
      'request_for_bids_tenant_status_mineral_idx',
    ).on(t.tenantId, t.status, t.mineralKind),
    openGeoIdx: index('request_for_bids_open_geo_idx').on(
      t.locationLat,
      t.locationLon,
    ),
    expiresAtIdx: index('request_for_bids_expires_at_idx').on(t.expiresAt),
  }),
);

export const requestForBidResponses = pgTable(
  'request_for_bid_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rfbId: uuid('rfb_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    sellerId: text('seller_id').notNull(),
    offeredTonnage: numeric('offered_tonnage', {
      precision: 10,
      scale: 3,
    }).notNull(),
    offeredPriceTzs: numeric('offered_price_tzs', {
      precision: 15,
      scale: 2,
    }).notNull(),
    deliveryBy: date('delivery_by').notNull(),
    notes: text('notes'),
    /** pending | accepted | rejected | withdrawn */
    status: text('status').notNull().default('pending'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    rfbStatusIdx: index('rfb_responses_rfb_status_idx').on(
      t.rfbId,
      t.status,
      t.createdAt,
    ),
    tenantSellerIdx: index('rfb_responses_tenant_seller_idx').on(
      t.tenantId,
      t.sellerId,
      t.createdAt,
    ),
  }),
);

export type RequestForBid = typeof requestForBids.$inferSelect;
export type RequestForBidInsert = typeof requestForBids.$inferInsert;
export type RequestForBidResponse =
  typeof requestForBidResponses.$inferSelect;
export type RequestForBidResponseInsert =
  typeof requestForBidResponses.$inferInsert;
