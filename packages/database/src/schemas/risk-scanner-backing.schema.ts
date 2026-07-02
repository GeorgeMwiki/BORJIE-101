/**
 * Risk-Scanner Backing Relations — Wave Tier-1 powers reality.
 *
 * Companion to:
 *   - packages/database/src/migrations/0370_risk_scanner_backing.sql
 *   - packages/database/src/seeds/risk-scanner-backing.seed.ts
 *   - services/api-gateway/src/services/risk-scanner/scanner.ts
 *
 * The 33-rule risk scanner reads a state snapshot from these owner-provided
 * relations. Each was genuinely absent (the scanner fail-softed every field to
 * null), so the matching rules could never fire on real data. Migration 0370
 * creates them with FORCE RLS + a tenant-isolation policy on the canonical
 * `app.current_tenant_id` GUC; the companion seed fills the live demo/test
 * tenants with REAL representative mining values.
 *
 * `production_mom_summary` is NOT here — it is a SECURITY INVOKER VIEW computed
 * from `production_tonnage_events` (migration 0370), read directly via raw SQL
 * by the scanner. Views carry no Drizzle table schema.
 *
 * All `tenant_id` columns are TEXT to match every base table in this repo.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  uuid,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Owner AR ledger with per-invoice aging (cash.ar_aging_critical). */
export const accountsReceivable = pgTable(
  'accounts_receivable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    buyerId: text('buyer_id'),
    buyerName: text('buyer_name'),
    invoiceNo: text('invoice_no'),
    amountTzs: numeric('amount_tzs', { precision: 18, scale: 2 }).notNull(),
    agingDays: integer('aging_days').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('accounts_receivable_tenant_idx').on(t.tenantId, t.agingDays),
  }),
);

/** Next payroll run + amount (hr.payroll_readiness_gap). */
export const payrollSchedule = pgTable(
  'payroll_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    totalAmountTzs: numeric('total_amount_tzs', { precision: 18, scale: 2 }).notNull(),
    headcount: integer('headcount').notNull().default(0),
    cadence: text('cadence').notNull().default('monthly'),
    status: text('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantNextIdx: index('payroll_schedule_tenant_next_idx').on(t.tenantId, t.nextRunAt),
  }),
);

/** Standing on-site fuel stock + burn (operational.fuel_inventory_below_safety). */
export const fuelInventory = pgTable(
  'fuel_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    siteId: text('site_id'),
    fuelKind: text('fuel_kind').notNull().default('diesel'),
    litresRemaining: numeric('litres_remaining', { precision: 12, scale: 2 }).notNull(),
    dailyBurnLitres: numeric('daily_burn_litres', { precision: 12, scale: 2 }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('fuel_inventory_tenant_idx').on(t.tenantId),
  }),
);

/** Equipment failure events (operational.equipment_failure_pattern). */
export const equipmentFailures = pgTable(
  'equipment_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    siteId: text('site_id'),
    equipmentKind: text('equipment_kind').notNull(),
    assetId: text('asset_id'),
    failureMode: text('failure_mode'),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('equipment_failures_tenant_idx').on(t.tenantId, t.failedAt),
  }),
);

/** Workforce separations (hr.supervisor_attrition_spike). */
export const workforceSeparations = pgTable(
  'workforce_separations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    employeeId: text('employee_id'),
    fullName: text('full_name'),
    role: text('role').notNull(),
    separationKind: text('separation_kind').notNull().default('resignation'),
    separatedAt: timestamp('separated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('workforce_separations_tenant_idx').on(t.tenantId, t.separatedAt),
  }),
);

/** Royalty draft + trailing avg (compliance.audit_trigger_signal). */
export const royaltyDraftsWithTrend = pgTable(
  'royalty_drafts_with_trend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    draftDate: date('draft_date').notNull(),
    currentDraftTzs: numeric('current_draft_tzs', { precision: 18, scale: 2 }).notNull(),
    trailingAvgTzs: numeric('trailing_avg_tzs', { precision: 18, scale: 2 }).notNull(),
    mineral: text('mineral'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('royalty_drafts_with_trend_tenant_idx').on(t.tenantId, t.draftDate),
  }),
);

/** Per-regulator health tone (compliance.regulator_stop_work_risk). */
export const regulatorStatus = pgTable(
  'regulator_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    regulator: text('regulator').notNull(),
    statusTone: text('status_tone').notNull().default('green'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantRegUq: uniqueIndex('regulator_status_tenant_reg_uq').on(t.tenantId, t.regulator),
  }),
);

/** Buyer credit signals (counterparty.buyer_default_signal). */
export const buyerCreditSignals = pgTable(
  'buyer_credit_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    buyerId: text('buyer_id').notNull(),
    buyerName: text('buyer_name').notNull(),
    latePaymentCount: integer('late_payment_count').notNull().default(0),
    crbScoreDelta: integer('crb_score_delta'),
    lastSignalAt: timestamp('last_signal_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('buyer_credit_signals_tenant_idx').on(t.tenantId),
  }),
);

/** Supplier quality signals (counterparty.supplier_quality_drop). */
export const supplierQualitySignals = pgTable(
  'supplier_quality_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    supplierId: text('supplier_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    offSpecCount: integer('off_spec_count').notNull().default(0),
    windowDays: integer('window_days').notNull().default(60),
    lastSignalAt: timestamp('last_signal_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('supplier_quality_signals_tenant_idx').on(t.tenantId, t.windowDays),
  }),
);

/** Security audit events (security.access_anomaly / kill_switch_potential). */
export const securityAuditEvents = pgTable(
  'security_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    eventKind: text('event_kind').notNull(),
    actorId: text('actor_id'),
    ipAddress: text('ip_address'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('security_audit_events_tenant_idx').on(t.tenantId, t.occurredAt),
  }),
);

/** CDA milestones (reputational.csr_commitment_slipping). */
export const cdaMilestones = pgTable(
  'cda_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    commitment: text('commitment'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('on_track'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('cda_milestones_tenant_idx').on(t.tenantId, t.status),
  }),
);

/** Withholding tax summary (tax.withholding_exposure_critical). */
export const withholdingTaxSummary = pgTable(
  'withholding_tax_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    periodLabel: text('period_label').notNull(),
    payableTzs: numeric('payable_tzs', { precision: 18, scale: 2 }).notNull().default('0'),
    provisionTzs: numeric('provision_tzs', { precision: 18, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantPeriodUq: uniqueIndex('withholding_tax_summary_tenant_period_uq').on(
      t.tenantId,
      t.periodLabel,
    ),
  }),
);

/** TRA correspondence (tax.tra_inquiry_signal). */
export const traCorrespondence = pgTable(
  'tra_correspondence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    subject: text('subject'),
    inquiryOpen: boolean('inquiry_open').notNull().default(false),
    lastFiledAt: timestamp('last_filed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('tra_correspondence_tenant_idx').on(t.tenantId),
  }),
);

/** Contracts (legal.contract_expiring_critical). */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    counterpartyName: text('counterparty_name').notNull(),
    contractKind: text('contract_kind').notNull().default('offtake'),
    annualValueTzs: numeric('annual_value_tzs', { precision: 18, scale: 2 }),
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantExpiryIdx: index('contracts_tenant_expiry_idx').on(t.tenantId, t.expiresAt),
  }),
);

/** Contract renewal workflows (legal.contract_expiring_critical join). */
export const contractRenewalWorkflows = pgTable(
  'contract_renewal_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    status: text('status').notNull().default('drafting'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('contract_renewal_workflows_tenant_idx').on(t.tenantId, t.contractId),
  }),
);

/** Disputes (legal.dispute_escalation_pattern). */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    counterpartyId: text('counterparty_id').notNull(),
    counterpartyName: text('counterparty_name').notNull(),
    subject: text('subject'),
    status: text('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('disputes_tenant_idx').on(t.tenantId, t.openedAt),
  }),
);
