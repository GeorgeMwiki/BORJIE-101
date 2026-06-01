/**
 * Settlements — commercial-chain L8 payout settlement record.
 *
 * One row per chain-of-custody final-step signature (buyer -> owner ->
 * manager -> worker -> buyer loop closure). Computes gross / royalty / fee /
 * net, stamps the double-entry ledger journal id from `LedgerService.post()`
 * (CLAUDE.md hard rule), and tracks the M-Pesa B2C / wallet payout to the
 * seller.
 *
 * Table created in migration 0131_settlements.sql. The four money columns were
 * migrated from numeric(15,2) to BIGINT INTEGER MINOR UNITS in
 * 0161_settlements_integer_precision.sql — TZS is 0-decimal so a minor unit ==
 * one whole shilling. This Drizzle schema reflects the POST-0161 layout.
 *
 * Money model (CLAUDE.md hard rule)
 * ---------------------------------
 * gross/royalty/fee/net are `bigint` minor units, NEVER float / numeric. The
 * settlement orchestrator service MUST compute gross = tonnage * price,
 * royalty, fee, and net = gross - royalty - fee in INTEGER minor units
 * (the DB enforces `net_tzs = gross_tzs - royalty_tzs - fee_tzs` via the
 * `settlements_math_chk` constraint from 0131).
 *
 * `mode: 'number'` keeps the values as JS numbers for the service math; whole
 * TZS shillings stay well inside Number.MAX_SAFE_INTEGER for realistic
 * settlement magnitudes, while the BIGINT column removes the numeric(15,2)
 * overflow ceiling.
 *
 * RLS: tenant-scoped FORCE row-level security on the `app.current_tenant_id`
 * GUC — policy created in migration 0131.
 *
 * NB: indexes + CHECK constraints are declared in SQL (0131) and the column
 * type change in 0161; this `pgTable` builder is index-free to mirror the
 * rest of the package boundary.
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
} from 'drizzle-orm/pg-core';

// ============================================================================
// settlements — one row per CoC final-step signature
// ============================================================================

export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** RLS-scoping column. */
  tenantId: uuid('tenant_id').notNull(),
  rfbId: uuid('rfb_id').notNull(),
  responseId: uuid('response_id').notNull(),
  /** Gross = tonnage * price. WHOLE TZS (BIGINT minor units). See 0161. */
  grossTzs: bigint('gross_tzs', { mode: 'number' }).notNull(),
  /** Royalty (TZ default 7% gold). WHOLE TZS (BIGINT minor units). */
  royaltyTzs: bigint('royalty_tzs', { mode: 'number' }).notNull(),
  /** Platform fee (1.5%). WHOLE TZS (BIGINT minor units). */
  feeTzs: bigint('fee_tzs', { mode: 'number' }).notNull(),
  /** Net = gross - royalty - fee. WHOLE TZS (BIGINT minor units). */
  netTzs: bigint('net_tzs', { mode: 'number' }).notNull(),
  /** pending | posted | paying_out | completed | failed. */
  status: text('status').notNull().default('pending'),
  /** Ledger journal id from LedgerService.post(). NULL until the post lands. */
  ledgerTxnId: text('ledger_txn_id'),
  /** M-Pesa B2C | wallet | stripe (future). NULL until payout fires. */
  payoutProvider: text('payout_provider'),
  payoutProviderRef: text('payout_provider_ref'),
  /** Idempotency on coCStepChecksum — a replayed sign-delivery short-circuits. */
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
