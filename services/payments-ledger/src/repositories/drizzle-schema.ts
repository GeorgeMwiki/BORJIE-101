/**
 * Local Drizzle Schema — payments-ledger service
 *
 * The canonical `@borjie/database` package archived the payments-ledger
 * tables (see `packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql`)
 * as part of the mining-domain pivot, but the Drizzle repository
 * implementations in this service still reference the table shapes for
 * production deployments that retain the legacy schema in the database.
 *
 * To keep the cross-package boundary clean (no schema additions to
 * `@borjie/database`) we declare the table definitions locally here.
 * They are consumed only by the `drizzle-*.repository.ts` adapters and
 * mirror the exact column layout from the archived migration. Runtime
 * behaviour is preserved — Drizzle's `pgTable` objects carry their own
 * metadata, so SQL generation works whether or not the schema is wired
 * into the `DatabaseClient`'s relational config.
 *
 * Column-name parity with the archived `ledger.schema.ts` /
 * `payments-ledger.schema.ts` is mandatory; the repository adapters
 * speak the same `*_minor_units`, `failure_reason`, `recipient_email`,
 * etc. dialect.
 *
 * Persona: Mr. Mwikila — narrow, type-safe boundary, no schema sprawl.
 *
 * Note: index/uniqueIndex callbacks are intentionally omitted from
 * these declarations — they exist as DB-level constraints (see
 * archived migration 0167b) but are not required for TypeScript
 * inference of the table objects used by the repository adapters.
 * Keeping the table builders index-free also avoids non-portable
 * inferred-type leaks (TS2883) across the package boundary.
 */

import { pgTable, text, timestamp, integer, bigint, jsonb } from 'drizzle-orm/pg-core';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

// Anchor the drizzle column/table types in this module so the
// `declaration: true` build names the inferred `pgTable` export types via a
// portable specifier instead of drizzle's internal `*.cjs` paths — fixes
// TS2883 ("inferred type cannot be named") on the `statements` /
// `disbursements` exports. Emit-only; the service does not re-export these.
type _DrizzleEmitAnchor = PgColumn | PgTableWithColumns<never>;
export type { _DrizzleEmitAnchor };

// ────────────────────────────────────────────────────────────────────
// accounts
// ────────────────────────────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id'),
  ownerId: text('owner_id'),
  propertyId: text('property_id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  // C2 — overflow safety: money minor-unit columns are BIGINT (mode
  // 'number' keeps the JS type `number`). entry_count is a row-version
  // counter, not money, so it stays INTEGER.
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

export type AccountRow = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// ledger_entries
// ────────────────────────────────────────────────────────────────────

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  journalId: text('journal_id').notNull(),
  type: text('type').notNull(),
  direction: text('direction').notNull(),
  // C2 — overflow safety: BIGINT money columns (mode 'number').
  // sequence_number is an ordering counter, not money → stays INTEGER.
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  balanceAfterMinorUnits: bigint('balance_after_minor_units', {
    mode: 'number',
  }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  effectiveDate: timestamp('effective_date', {
    withTimezone: true,
  }).notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
});

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type LedgerEntryInsert = typeof ledgerEntries.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// payment_intents
// ────────────────────────────────────────────────────────────────────

export const paymentIntents = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id').notNull(),
  leaseId: text('lease_id'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  // C2 — overflow safety: BIGINT money columns (mode 'number').
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  platformFeeMinorUnits: bigint('platform_fee_minor_units', {
    mode: 'number',
  }),
  netAmountMinorUnits: bigint('net_amount_minor_units', { mode: 'number' }),
  providerName: text('provider_name'),
  externalId: text('external_id'),
  description: text('description'),
  statementDescriptor: text('statement_descriptor'),
  idempotencyKey: text('idempotency_key'),
  receiptUrl: text('receipt_url'),
  // C2 — overflow safety: BIGINT money column (mode 'number').
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

export type PaymentIntentRow = typeof paymentIntents.$inferSelect;
export type PaymentIntentInsert = typeof paymentIntents.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// statements
// ────────────────────────────────────────────────────────────────────

export const statements = pgTable('statements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  ownerId: text('owner_id'),
  customerId: text('customer_id'),
  propertyId: text('property_id'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  periodType: text('period_type').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  currency: text('currency').notNull(),
  // C2 — overflow safety: BIGINT money columns (mode 'number'). A
  // period statement can sum many entries, so it is the most exposed to
  // INT4 overflow of all the money columns.
  openingBalanceMinorUnits: bigint('opening_balance_minor_units', {
    mode: 'number',
  }),
  closingBalanceMinorUnits: bigint('closing_balance_minor_units', {
    mode: 'number',
  }),
  totalDebitsMinorUnits: bigint('total_debits_minor_units', {
    mode: 'number',
  }),
  totalCreditsMinorUnits: bigint('total_credits_minor_units', {
    mode: 'number',
  }),
  netChangeMinorUnits: bigint('net_change_minor_units', { mode: 'number' }),
  lineItems: jsonb('line_items').notNull().default([]),
  summaries: jsonb('summaries').notNull().default([]),
  recipientEmail: text('recipient_email'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  documentUrl: text('document_url'),
  generatedAt: timestamp('generated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
});

export type StatementRow = typeof statements.$inferSelect;
export type StatementInsert = typeof statements.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// disbursements
// ────────────────────────────────────────────────────────────────────

export const disbursements = pgTable('disbursements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  // C2 — overflow safety: BIGINT money column (mode 'number').
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  destination: text('destination').notNull(),
  destinationType: text('destination_type').notNull().default('bank_account'),
  provider: text('provider'),
  transferId: text('transfer_id'),
  providerResponse: jsonb('provider_response').default({}),
  description: text('description'),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  estimatedArrival: timestamp('estimated_arrival', { withTimezone: true }),
  failureReason: text('failure_reason'),
  failureCode: text('failure_code'),
  idempotencyKey: text('idempotency_key'),
  ledgerEntryId: text('ledger_entry_id'),
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

export type DisbursementRow = typeof disbursements.$inferSelect;
export type DisbursementInsert = typeof disbursements.$inferInsert;
