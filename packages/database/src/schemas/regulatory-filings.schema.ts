/**
 * regulatory_filings — calendar of obligations to mining commission,
 * TRA, NEMC, BoT, TCRA, OSHA, ICA, LBMA, TBS, customs, and other
 * regulators. Read by the regulatory-calendar page and the brain's
 * `check_regulatory_deadline` tool.
 *
 * Companion to:
 *   - packages/database/src/migrations/0093_full_mining_operations_scope.sql
 *   - services/api-gateway/src/routes/ops/regulatory-filings.hono.ts
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const regulatoryFilings = pgTable(
  'regulatory_filings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** mining_commission | tra | nemc | bot | tcra | osha | ica |
     *  lbma | tbs | tphpa | tlb | pra | customs | brela | other. */
    regulator: text('regulator').notNull(),
    filingType: text('filing_type').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    status: text('status').notNull().default('upcoming'),
    referenceNo: text('reference_no'),
    payloadDocId: text('payload_doc_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedOutcome: text('decided_outcome'),
    feePaidTzs: numeric('fee_paid_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantDueIdx: index('idx_rf_tenant_due').on(
      t.tenantId,
      t.dueAt,
      t.status,
    ),
    tenantRegulatorIdx: index('idx_rf_tenant_regulator').on(
      t.tenantId,
      t.regulator,
      t.status,
    ),
  }),
);

export type RegulatoryFiling = typeof regulatoryFilings.$inferSelect;
export type NewRegulatoryFiling = typeof regulatoryFilings.$inferInsert;

export const REGULATORS = [
  'mining_commission',
  'tra',
  'nemc',
  'bot',
  'tcra',
  'osha',
  'ica',
  'lbma',
  'tbs',
  'tphpa',
  'tlb',
  'pra',
  'customs',
  'brela',
  'other',
] as const;
export type Regulator = (typeof REGULATORS)[number];

export const FILING_STATUSES = [
  'upcoming',
  'in_progress',
  'submitted',
  'approved',
  'rejected',
  'overdue',
  'cancelled',
] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];
