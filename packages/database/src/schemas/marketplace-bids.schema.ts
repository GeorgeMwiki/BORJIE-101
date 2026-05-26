/**
 * Marketplace bids — buyer bids on marketplace listings.
 *
 * Dedicated bid store. Replaces the temporal-graph BID_ON edge
 * workaround previously used by `services/api-gateway/src/routes/
 * mining/bids.hono.ts`. Backed by a first-class `marketplace_bids`
 * table so the route can join cleanly to listings + buyers and so
 * the lifecycle (pending → accepted | rejected | countered |
 * withdrawn) is enforced at the type level.
 *
 * Status state machine:
 *   pending   → (seller) accepted | rejected | countered
 *   pending   → (buyer)  withdrawn
 *   countered → (buyer)  accepted | rejected | withdrawn
 *
 * `signed_fingerprint_event_id` references the biometric attestation
 * recorded on acceptance (see `fingerprint_events`). Nullable until
 * an acceptance signature is captured.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';
import { marketplaceListings } from './marketplace.schema.js';
import { buyers } from './production-sales.schema.js';
import { fingerprintEvents } from './fingerprint-events.schema.js';

// ============================================================================
// Enums
// ============================================================================

export const marketplaceBidPaymentTermsEnum = pgEnum(
  'marketplace_bid_payment_terms',
  ['instant', 'net_30', 'net_60'],
);

export const marketplaceBidStatusEnum = pgEnum('marketplace_bid_status', [
  'pending',
  'accepted',
  'rejected',
  'countered',
  'withdrawn',
]);

// ============================================================================
// marketplace_bids
// ============================================================================

export const marketplaceBids = pgTable(
  'marketplace_bids',
  {
    /** ULID-shaped opaque id (text). */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    listingId: text('listing_id')
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'restrict' }),
    bidPriceTzs: numeric('bid_price_tzs', { precision: 18, scale: 2 }).notNull(),
    paymentTerms: marketplaceBidPaymentTermsEnum('payment_terms')
      .notNull()
      .default('instant'),
    notes: text('notes'),
    status: marketplaceBidStatusEnum('status').notNull().default('pending'),
    counterPriceTzs: numeric('counter_price_tzs', { precision: 18, scale: 2 }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** FK to fingerprint_events row produced by the seller on accept. */
    signedFingerprintEventId: text('signed_fingerprint_event_id'),
    /** Optional free-form metadata (rejection reason, etc.). */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('marketplace_bids_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    listingIdx: index('marketplace_bids_listing_idx').on(t.listingId),
    buyerIdx: index('marketplace_bids_buyer_idx').on(t.buyerId),
  }),
);

// ============================================================================
// Relations
// ============================================================================

export const marketplaceBidsRelations = relations(marketplaceBids, ({ one }) => ({
  tenant: one(tenants, {
    fields: [marketplaceBids.tenantId],
    references: [tenants.id],
  }),
  listing: one(marketplaceListings, {
    fields: [marketplaceBids.listingId],
    references: [marketplaceListings.id],
  }),
  buyer: one(buyers, {
    fields: [marketplaceBids.buyerId],
    references: [buyers.id],
  }),
  signedFingerprintEvent: one(fingerprintEvents, {
    fields: [marketplaceBids.signedFingerprintEventId],
    references: [fingerprintEvents.id],
  }),
}));

export type MarketplaceBid = typeof marketplaceBids.$inferSelect;
export type NewMarketplaceBid = typeof marketplaceBids.$inferInsert;
