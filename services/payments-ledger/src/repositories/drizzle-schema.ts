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
 * Column-name parity with the archived `ledger.schema.ts` is mandatory;
 * the repository adapters speak the same `*_minor_units`,
 * `failure_reason`, `recipient_email`, etc. dialect.
 *
 * Persona: Mr. Mwikila — narrow, type-safe boundary, no schema sprawl.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  type PgTable,
} from 'drizzle-orm/pg-core';

// ────────────────────────────────────────────────────────────────────
// accounts
//
// PgTable annotation is intentional: it pins the exported symbol's
// public type to a portable reference (PgTable from drizzle-orm/pg-core)
// while the local `const` retains the full inferred column type for the
// repository implementations below. This avoids the TS2883 "inferred
// type cannot be named" warning that would otherwise leak deep
// drizzle-orm generics into the emitted .d.ts. Repositories cast back
// to the local inferred type via the row helpers.
// ────────────────────────────────────────────────────────────────────

const accountsTable = pgTable('accounts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id'),
  ownerId: text('owner_id'),
  propertyId: text('property_id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  balanceMinorUnits: integer('balance_minor_units').notNull().default(0),
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

export type AccountRow = typeof accountsTable.$inferSelect;
export type AccountInsert = typeof accountsTable.$inferInsert;
export const accounts: typeof accountsTable = accountsTable;

// ────────────────────────────────────────────────────────────────────
// ledger_entries
// ────────────────────────────────────────────────────────────────────

const ledgerEntriesTable = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  journalId: text('journal_id').notNull(),
  type: text('type').notNull(),
  direction: text('direction').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  balanceAfterMinorUnits: integer('balance_after_minor_units').notNull(),
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

export type LedgerEntryRow = typeof ledgerEntriesTable.$inferSelect;
export type LedgerEntryInsert = typeof ledgerEntriesTable.$inferInsert;
export const ledgerEntries: typeof ledgerEntriesTable = ledgerEntriesTable;

// ────────────────────────────────────────────────────────────────────
// payment_intents
// ────────────────────────────────────────────────────────────────────

const paymentIntentsTable = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id').notNull(),
  leaseId: text('lease_id'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  platformFeeMinorUnits: integer('platform_fee_minor_units'),
  netAmountMinorUnits: integer('net_amount_minor_units'),
  providerName: text('provider_name'),
  externalId: text('external_id'),
  description: text('description'),
  statementDescriptor: text('statement_descriptor'),
  idempotencyKey: text('idempotency_key'),
  receiptUrl: text('receipt_url'),
  refundedAmountMinorUnits: integer('refunded_amount_minor_units').default(0),
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

export type PaymentIntentRow = typeof paymentIntentsTable.$inferSelect;
export type PaymentIntentInsert = typeof paymentIntentsTable.$inferInsert;
export const paymentIntents: typeof paymentIntentsTable = paymentIntentsTable;

// ────────────────────────────────────────────────────────────────────
// statements
// ────────────────────────────────────────────────────────────────────

const statementsTable = pgTable('statements', {
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
  openingBalanceMinorUnits: integer('opening_balance_minor_units'),
  closingBalanceMinorUnits: integer('closing_balance_minor_units'),
  totalDebitsMinorUnits: integer('total_debits_minor_units'),
  totalCreditsMinorUnits: integer('total_credits_minor_units'),
  netChangeMinorUnits: integer('net_change_minor_units'),
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

export type StatementRow = typeof statementsTable.$inferSelect;
export type StatementInsert = typeof statementsTable.$inferInsert;
export const statements: typeof statementsTable = statementsTable;

// ────────────────────────────────────────────────────────────────────
// disbursements
// ────────────────────────────────────────────────────────────────────

const disbursementsTable = pgTable('disbursements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
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

export type DisbursementRow = typeof disbursementsTable.$inferSelect;
export type DisbursementInsert = typeof disbursementsTable.$inferInsert;
export const disbursements: typeof disbursementsTable = disbursementsTable;

// Suppress unused-import warning while keeping the explicit type
// reference in the file (the PgTable import documents the intent
// behind the `typeof xTable` annotations above; do not remove).
export type _PgTableRef = PgTable;
