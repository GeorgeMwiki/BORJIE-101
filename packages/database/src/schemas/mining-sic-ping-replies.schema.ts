/**
 * Mining SIC ping replies — worker quick-reply to a supervisor SIC ping.
 *
 * Companion to:
 *   - packages/database/src/migrations/0285_mining_sic_ping_replies.sql
 *   - services/api-gateway/src/routes/mining/cockpit.hono.ts (POST reply)
 *   - apps/workforce-mobile/app/worker/W-M-05.tsx (offline-queued reply)
 *
 * WHY A SEPARATE TABLE
 * --------------------
 * `mining_sic_pings` (migration 0082) is a one-shot supervisor status
 * emission and has NO reply columns. A worker's reply is a distinct
 * append-only fact (loads done + blockers + when), so it gets its own
 * row rather than mutating the ping (which would also break the
 * append-only spirit of the SIC queue).
 *
 * CLIENT-PING-REF NUANCE
 * ----------------------
 * The workforce-mobile offline reply (W-M-05) generates a *client-side*
 * id (`ping-<epoch>`) that is NOT a real `mining_sic_pings.id`. We
 * therefore store the client's reference as free-text `client_ping_ref`
 * and keep the optional real FK `ping_id` for callers that DO target a
 * concrete ping (the `POST /sic-pings/:id/reply` form). Neither is
 * required, so an offline-origin reply persists honestly without a
 * fabricated link.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const miningSicPingReplies = pgTable(
  'mining_sic_ping_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column (text, matching `mining_sic_pings.tenant_id`). */
    tenantId: text('tenant_id').notNull(),
    /**
     * Optional real ping this reply targets. NULL for offline-origin
     * replies whose only handle is a client-generated ref.
     */
    pingId: uuid('ping_id'),
    /** The client's own ping reference (e.g. `ping-1717689600000`). */
    clientPingRef: text('client_ping_ref'),
    /** Worker who replied. */
    repliedByUserId: text('replied_by_user_id').notNull(),
    /**
     * Loads done this interval. Stored as integer minor-quantity (count
     * of loads). NULL when the client sent a non-numeric value — the
     * raw text is preserved in `loads_raw` so nothing is lost.
     */
    loads: integer('loads'),
    /** Raw loads text exactly as the worker typed it (audit fidelity). */
    loadsRaw: text('loads_raw'),
    /** Free-text blockers (Swahili-first), empty when none. */
    blockers: text('blockers'),
    /** When the worker replied (client-supplied; defaults to now). */
    repliedAt: timestamp('replied_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantRepliedAtIdx: index(
      'idx_mining_sic_ping_replies_tenant_replied_at',
    ).on(t.tenantId, t.repliedAt),
    pingIdx: index('idx_mining_sic_ping_replies_ping').on(
      t.tenantId,
      t.pingId,
    ),
  }),
);

export type MiningSicPingReply = typeof miningSicPingReplies.$inferSelect;
export type NewMiningSicPingReply = typeof miningSicPingReplies.$inferInsert;
