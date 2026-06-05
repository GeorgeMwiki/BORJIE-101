/**
 * Bid messages — WS-2 buyer ↔ seller bid chat / messaging.
 *
 * One row per message in a thread. A "thread" is keyed by
 * `rfb_response_id` (request_for_bid_responses.id) — one thread per RFB
 * response. The two participants live in DIFFERENT tenants by
 * construction (buyer = parent RFB tenant; seller = response tenant),
 * so reads are participant-aware while writes stay tenant-locked. The
 * thread is reconstructed by selecting all rows for a `rfb_response_id`
 * ordered by `created_at ASC`. Rows are APPEND-ONLY.
 *
 * Companion to:
 *   - packages/database/src/migrations/0172_bid_messages.sql (RLS FORCE,
 *     idempotent-send partial unique index)
 *   - services/api-gateway/src/routes/mining/bid-messaging.hono.ts
 *
 * tenant_id is TEXT to match tenants.id TEXT heritage (see migration
 * 0150). It carries the SENDER's tenant.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import {
  requestForBids,
  requestForBidResponses,
} from './request-for-bids.schema.js';
import { provenanceColumn } from '../helpers/provenance-column.js';

export const BID_MESSAGE_SENDER_ROLES = ['buyer', 'seller'] as const;
export type BidMessageSenderRole = (typeof BID_MESSAGE_SENDER_ROLES)[number];

export const bidMessages = pgTable(
  'bid_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SENDER's tenant. TEXT to match tenants.id TEXT (see 0150). */
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Thread key — the RFB response this conversation hangs off. */
    rfbResponseId: uuid('rfb_response_id')
      .notNull()
      .references(() => requestForBidResponses.id, { onDelete: 'cascade' }),
    /** Denormalised parent RFB id for the cheap buyer-side read path. */
    rfbId: uuid('rfb_id')
      .notNull()
      .references(() => requestForBids.id, { onDelete: 'cascade' }),
    /** Authoring user id (text — mirrors seller_id / buyer_id). */
    senderId: text('sender_id').notNull(),
    /** 'buyer' (RFB owner) | 'seller' (responder). */
    senderRole: text('sender_role').notNull(),
    body: text('body').notNull(),
    /** Idempotency-Key header value; NULL when the client sent none. */
    idempotencyKey: text('idempotency_key'),
    provenance: provenanceColumn(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    responseCreatedIdx: index('bid_messages_response_created_idx').on(
      t.rfbResponseId,
      t.createdAt,
    ),
    rfbIdx: index('bid_messages_rfb_idx').on(t.rfbId, t.createdAt),
    tenantIdx: index('bid_messages_tenant_idx').on(t.tenantId, t.createdAt),
    /** Idempotent-send dedup — partial, only Idempotency-Key'd rows. */
    idemUnique: uniqueIndex('bid_messages_idem_unique')
      .on(t.rfbResponseId, t.senderId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

export type BidMessage = typeof bidMessages.$inferSelect;
export type NewBidMessage = typeof bidMessages.$inferInsert;
