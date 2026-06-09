/**
 * Offtake agreements — the binding mineral-supply contract crystallized
 * when a seller ACCEPTS a marketplace bid.
 *
 * MARKETPLACE LAUNCH BLOCKER (LANE B3) closure. Before this table,
 * accepting a `marketplace_bids` row merely flipped its status to
 * `accepted`; no durable offtake contract existed (the only reference to
 * an offtake agreement lived in the excised estate doc-routing module,
 * `estate.register_offtake_agreement`, which targeted a dead surface).
 * This table is the first-class binding-contract record: one row per
 * accepted bid (UNIQUE on `bid_id`) so the accept is idempotent.
 *
 * MONEY DISCIPLINE (CLAUDE.md hard rule): the `agreed_price_tzs` /
 * `quantity_kg` columns here are CONTRACT TERMS — the negotiated price &
 * volume the parties agreed to. They are NOT ledger entries. Actual
 * settlement (escrow, payout, royalty) still flows through
 * `LedgerService.post()` (immutable double-entry); this table never
 * posts accounting truth and is never written by the money path.
 *
 * TENANT SCOPE (CLAUDE.md hard rule): `tenant_id` is the SELLER tenant
 * (the listing owner) — same shape as `marketplace_bids` /
 * `marketplace_listings`. `buyer_tenant_id` is the buyer's own home
 * tenant when known (nullable; the `buyers` row already lives in the
 * seller tenant). RLS FORCE on the canonical `app.current_tenant_id`
 * GUC isolates every tenant from every other. Companion migration:
 * 0325_offtake_agreements.sql.
 */

import {
  pgTable,
  text,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// offtake_agreements — one binding contract per accepted marketplace bid.
// ============================================================================

export const offtakeAgreements = pgTable(
  'offtake_agreements',
  {
    /** Opaque id (text — ULID/UUID shaped). */
    id: text('id').primaryKey(),
    /** SELLER tenant (the listing owner). RLS isolation key. */
    tenantId: text('tenant_id').notNull(),
    /** The marketplace listing the accepted bid targeted. */
    listingId: text('listing_id').notNull(),
    /** The accepted `marketplace_bids` row. UNIQUE — accept is idempotent. */
    bidId: text('bid_id').notNull(),
    /** The `buyers` row (in the seller tenant) that placed the bid. */
    buyerId: text('buyer_id').notNull(),
    /** The buyer's own home tenant, when known (nullable). */
    buyerTenantId: text('buyer_tenant_id'),
    /** CONTRACT TERM — negotiated price. NOT a ledger entry. */
    agreedPriceTzs: numeric('agreed_price_tzs', {
      precision: 18,
      scale: 2,
    }).notNull(),
    /** CONTRACT TERM — agreed volume. NOT a ledger entry. */
    quantityKg: numeric('quantity_kg', { precision: 14, scale: 3 }).notNull(),
    /** Free-form payment terms snapshot (e.g. instant | net_30 | net_60). */
    paymentTerms: text('payment_terms'),
    /**
     * Lifecycle: pending_signature → signed → ... A freshly crystallized
     * contract awaits the parties' signatures.
     */
    status: text('status').notNull().default('pending_signature'),
    /** Stamped when both parties have signed (nullable until then). */
    signedAt: timestamp('signed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-delete tombstone (nullable; never hard-deleted). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    /** One offtake agreement per accepted bid → idempotent crystallization. */
    bidUnique: uniqueIndex('offtake_agreements_bid_id_key').on(t.bidId),
    /** Seller-facing list-by-tenant read. */
    tenantIdx: index('offtake_agreements_tenant_idx').on(t.tenantId),
    /** Buyer-facing list-by-buyer read (tenant-scoped). */
    buyerIdx: index('offtake_agreements_buyer_idx').on(t.tenantId, t.buyerId),
    /** Lookup by the originating listing. */
    listingIdx: index('offtake_agreements_listing_idx').on(t.listingId),
  }),
);

export type OfftakeAgreement = typeof offtakeAgreements.$inferSelect;
export type NewOfftakeAgreement = typeof offtakeAgreements.$inferInsert;
