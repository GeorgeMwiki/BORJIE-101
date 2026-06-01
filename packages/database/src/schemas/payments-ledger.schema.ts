/**
 * Payments-ledger — double-entry money spine (accounts, ledger_entries,
 * payment_intents) restored into the canonical @borjie/database schema set.
 *
 * Companion to migration 0160_payments_ledger_restore.sql. These tables back
 * the CLAUDE.md hard rule "Money path goes through LedgerService.post()". They
 * previously lived ONLY in the archived BossNyumba lineage
 * (packages/database/.archive/migrations/0001c + 0167b + 0174 + 0169b) and in
 * the payments-ledger service's own local Drizzle declarations
 * (services/payments-ledger/src/repositories/drizzle-schema.ts). Column-name
 * parity with that service declaration is MANDATORY — the repository adapters
 * speak the `*_minor_units`, `failure_reason`, `idempotency_key`, etc. dialect.
 *
 * Money model (CLAUDE.md hard rule)
 * ---------------------------------
 * Every money amount is an INTEGER MINOR UNIT — never float / numeric. TZS is
 * a 0-decimal currency, so a minor unit == one whole shilling. The STORAGE
 * type is `bigint` (with `mode: 'number'`): a single realistic
 * gold/tanzanite settlement, and the shared clearing/payable balances that
 * ACCUMULATE with volume, exceed INTEGER's 2.147e9 ceiling and would throw
 * Postgres 22003 numeric_value_out_of_range — so all `*_minor_units` money
 * columns are `bigint(..., { mode: 'number' })` (mirrors 0160 + the 0161
 * settlements widening). `mode: 'number'` keeps the JS type as a plain
 * number; whole TZS shillings stay far inside Number.MAX_SAFE_INTEGER
 * (9.007e15), so no BigInt refactor is needed. `entryCount` /
 * `sequenceNumber` are COUNTS, not money, and stay `integer`.
 *
 * Durability (sibling-owned)
 * --------------------------
 * `ledgerEntries` carries three NEW append-only durability columns a sibling
 * ledger agent depends on: `idempotencyKey` (+ a UNIQUE (tenant_id,
 * idempotency_key) index in SQL) for post-once replay safety, and
 * `prevHash` / `thisHash` for the tamper-evident hash chain. They are
 * nullable so the schema is valid over pre-durability rows; the sibling
 * backfills and begins writing them.
 *
 * RLS: every table is tenant-scoped via FORCE row-level security on the
 * `app.current_tenant_id` GUC. The SQL policies are created in migration 0160
 * (mirroring 0157's correct GUC). No app-code filtering — RLS enforces it.
 *
 * NB: indexes / unique constraints are intentionally declared in SQL (0160)
 * rather than in these `pgTable` builders. Keeping the builders index-free
 * mirrors the payments-ledger service's own declaration and avoids
 * non-portable inferred-type leaks across the package boundary.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
} from 'drizzle-orm/pg-core';

// ============================================================================
// accounts — double-entry account register
// ============================================================================

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id'),
  ownerId: text('owner_id'),
  propertyId: text('property_id'),
  name: text('name').notNull(),
  /** account_type (CUSTOMER_LIABILITY | OWNER_OPERATING | ...). TEXT-typed. */
  type: text('type').notNull(),
  /** account_status (ACTIVE | SUSPENDED | CLOSED). */
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  /** BIGINT minor units (whole TZS; integer-minor-units money, BIGINT storage). */
  balanceMinorUnits: bigint('balance_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
  lastEntryId: text('last_entry_id'),
  lastEntryAt: timestamp('last_entry_at', { withTimezone: true }),
  entryCount: integer('entry_count').notNull().default(0),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: text('closed_by'),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// ============================================================================
// ledger_entries — append-only double-entry lines (+ durability chain)
// ============================================================================

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  /** Correlates the balanced set of entries that posted together. */
  journalId: text('journal_id').notNull(),
  /** ledger_entry_type (RENT_PAYMENT | PLATFORM_FEE | ...). */
  type: text('type').notNull(),
  /** entry_direction (DEBIT | CREDIT). */
  direction: text('direction').notNull(),
  /** BIGINT minor units (integer-minor-units money, BIGINT storage). */
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  /** Account balance AFTER this entry, BIGINT minor units. */
  balanceAfterMinorUnits: bigint('balance_after_minor_units', {
    mode: 'number',
  }).notNull(),
  /** Per-account monotone sequence — ordering + hash-chain anchor. */
  sequenceNumber: integer('sequence_number').notNull(),
  effectiveDate: timestamp('effective_date', { withTimezone: true }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  paymentIntentId: text('payment_intent_id'),
  leaseId: text('lease_id'),
  propertyId: text('property_id'),
  unitId: text('unit_id'),
  invoiceId: text('invoice_id'),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default({}),
  // ── Tamper-evidence chain (sibling-owned, nullable for legacy rows) ──
  // Post-once idempotency is the SEPARATE journal_idempotency table (0162),
  // a per-JOURNAL grain — ledger_entries carries NO idempotency_key (a
  // per-entry UNIQUE would wrongly reject the 2nd..Nth line of one journal).
  /** Previous entry's `thisHash` (NULL for the genesis entry of a chain). */
  prevHash: text('prev_hash'),
  /** This entry's tamper-evident chain hash. */
  thisHash: text('this_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;

// ============================================================================
// payment_intents — inbound-money intent a journal settles against
// ============================================================================

export const paymentIntents = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id').notNull(),
  leaseId: text('lease_id'),
  /** payment_intent_type (RENT | DEPOSIT | ...). */
  type: text('type').notNull(),
  /** payment_intent_status (PENDING | SUCCEEDED | ...). */
  status: text('status').notNull(),
  /** BIGINT minor units (integer-minor-units money, BIGINT storage). */
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  platformFeeMinorUnits: bigint('platform_fee_minor_units', { mode: 'number' }),
  netAmountMinorUnits: bigint('net_amount_minor_units', { mode: 'number' }),
  providerName: text('provider_name'),
  externalId: text('external_id'),
  description: text('description'),
  statementDescriptor: text('statement_descriptor'),
  /** Post-once replay key. UNIQUE (tenant_id, idempotency_key) lives in 0160. */
  idempotencyKey: text('idempotency_key'),
  receiptUrl: text('receipt_url'),
  refundedAmountMinorUnits: bigint('refunded_amount_minor_units', {
    mode: 'number',
  }).default(0),
  failureReason: text('failure_reason'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
});

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;
