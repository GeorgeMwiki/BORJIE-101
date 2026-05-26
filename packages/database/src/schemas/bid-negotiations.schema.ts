/**
 * Bid negotiations — Borjie marketplace ore-parcel haggling.
 *
 * Each row is a single turn in a negotiation thread between a buyer and
 * a seller on a marketplace bid. The thread is reconstructed by
 * fetching all rows for a given `bid_id` ordered by `created_at ASC`.
 *
 * Turns are APPEND-ONLY — no UPDATE, no DELETE. A turn may optionally
 * link to a fingerprint event (`signed_fingerprint_event_id`) when the
 * user biometrically attested to the offer (e.g. accept/reject signed
 * with the on-device finger template). This ties the negotiation chain
 * back to the immutable fingerprint log for audit and dispute resolution.
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
import { fingerprintEvents } from './fingerprint-events.schema.js';
import { marketplaceBids } from './marketplace-bids.schema.js';

// Negotiation turns hang off the canonical `marketplace_bids` table. A
// CASCADE on bid deletion drops the entire negotiation thread with it,
// which matches the intent: a deleted bid never has live turns.

export const bidNegotiations = pgTable(
  'bid_negotiations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bidId: text('bid_id')
      .notNull()
      .references(() => marketplaceBids.id, { onDelete: 'cascade' }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /**
     * One of: offer | counter | accept | reject | withdraw.
     * - offer    — opening offer from buyer or seller.
     * - counter  — counter-offer on an existing thread.
     * - accept   — accept the most recent counter-party offer; closes thread.
     * - reject   — reject and close the thread.
     * - withdraw — author withdraws their own pending offer.
     */
    action: text('action').notNull(),
    /** Offered price in TZS minor units (cents). Required for offer/counter. */
    priceTzs: numeric('price_tzs', { precision: 18, scale: 2 }),
    /**
     * Free-form terms — payment schedule, delivery date, royalty handling,
     * inspection rights, etc. Stored as jsonb so terms can evolve.
     */
    termsJsonb: jsonb('terms_jsonb').notNull().default({}),
    /** Optional rationale / negotiator notes. */
    rationale: text('rationale'),
    /**
     * Optional reference to the fingerprint sign-off that attests this
     * turn. NULL means the turn was a soft (typed) action; non-null
     * means a biometric sign-off is on file (the canonical proof).
     */
    signedFingerprintEventId: text('signed_fingerprint_event_id').references(
      () => fingerprintEvents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('bid_negotiations_tenant_idx').on(t.tenantId),
    bidIdx: index('bid_negotiations_bid_idx').on(t.bidId, t.createdAt),
    actorIdx: index('bid_negotiations_actor_idx').on(t.fromUserId),
    actionIdx: index('bid_negotiations_action_idx').on(t.tenantId, t.action),
  }),
);

// ============================================================================
// Enum + type helpers
// ============================================================================

export const BID_NEGOTIATION_ACTIONS = [
  'offer',
  'counter',
  'accept',
  'reject',
  'withdraw',
] as const;
export type BidNegotiationAction = (typeof BID_NEGOTIATION_ACTIONS)[number];

/** Terminal actions close a thread; non-terminal actions leave it open. */
export const BID_NEGOTIATION_TERMINAL_ACTIONS = [
  'accept',
  'reject',
  'withdraw',
] as const;

export function isTerminalBidAction(action: BidNegotiationAction): boolean {
  return (
    BID_NEGOTIATION_TERMINAL_ACTIONS as readonly string[]
  ).includes(action);
}

export type BidNegotiation = typeof bidNegotiations.$inferSelect;
export type NewBidNegotiation = typeof bidNegotiations.$inferInsert;
