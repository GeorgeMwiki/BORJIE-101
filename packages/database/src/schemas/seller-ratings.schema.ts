/**
 * Seller ratings — WS-2 post-settlement seller reputation.
 *
 * One row per `settlements` row (settlement_id UNIQUE) — a buyer may
 * rate the seller they transacted with exactly once, and only after a
 * real, ledger-backed settlement exists (no "rate without buying"). The
 * rating aggregates into a reputation score surfaced on the seller's
 * org profile.
 *
 * Companion to:
 *   - packages/database/src/migrations/0173_seller_ratings.sql (RLS
 *     FORCE strict tenant isolation + seller_reputation() aggregate)
 *   - services/api-gateway/src/routes/mining/bid-messaging.hono.ts
 *     (POST .../rate + GET reputation)
 *
 * tenant_id is TEXT to match tenants.id TEXT heritage (see 0150) and
 * carries the RATER's tenant (the buyer's settlement tenant).
 * `seller_tenant_id` + `seller_id` are denormalised from
 * request_for_bid_responses so reputation aggregates are single-table.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import { settlements } from './settlements.schema.js';
import { provenanceColumn } from '../helpers/provenance-column.js';

export const sellerRatings = pgTable(
  'seller_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RATER's tenant (buyer's settlement tenant). TEXT — see 0150. */
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The ledger-backed settlement this rating attests to. */
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'cascade' }),
    /** Denormalised from the settlement's response. */
    rfbResponseId: uuid('rfb_response_id').notNull(),
    /** Rated seller's tenant (org-profile key) + user id. */
    sellerTenantId: text('seller_tenant_id').notNull(),
    sellerId: text('seller_id').notNull(),
    raterUserId: text('rater_user_id').notNull(),
    /** 1..5 stars (DB CHECK enforces the range). */
    stars: integer('stars').notNull(),
    comment: text('comment'),
    provenance: provenanceColumn(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** One rating per settlement (idempotent re-POST). */
    settlementUnique: unique('seller_ratings_settlement_unique').on(
      t.settlementId,
    ),
    sellerTenantIdx: index('seller_ratings_seller_tenant_idx').on(
      t.sellerTenantId,
      t.createdAt,
    ),
    sellerIdIdx: index('seller_ratings_seller_id_idx').on(
      t.sellerId,
      t.createdAt,
    ),
    tenantIdx: index('seller_ratings_tenant_idx').on(t.tenantId, t.createdAt),
  }),
);

export type SellerRating = typeof sellerRatings.$inferSelect;
export type NewSellerRating = typeof sellerRatings.$inferInsert;
