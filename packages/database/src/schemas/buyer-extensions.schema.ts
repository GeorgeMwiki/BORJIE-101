/**
 * Buyer financial-profile + risk-report extensions — Borjie mining domain.
 *
 * Two concerns live here:
 *
 *   1. Extension columns on `buyers` (credit limit, AML status, banking
 *      blob, payment history) modelled as a logical view on top of the
 *      existing table. The actual ALTER TABLE statements live in
 *      migration 0005; this module exposes the typed columns to Drizzle.
 *
 *   2. `buyer_risk_reports` — composite per-buyer risk score with
 *      dimensional sub-scores (KYC verdict, sanction-list hits,
 *      sectoral exposure, country risk). Append-mostly; the latest row
 *      per (tenant, buyer) is the active report.
 *
 * Tenant isolation enforced via tenant_id on every row + RLS policies
 * installed by migration 0005.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import { buyers } from './production-sales.schema.js';

// ============================================================================
// buyer_risk_reports — per-buyer composite risk score
// ============================================================================

export const buyerRiskReports = pgTable(
  'buyer_risk_reports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    /** Composite score 0 (lowest risk) - 100 (highest). */
    score0100: smallint('score_0_100').notNull().default(0),
    /** low|medium|high|critical. Derived from score; carried for query speed. */
    riskLevel: text('risk_level').notNull().default('low'),
    /**
     * Per-dimension breakdown — e.g. `{ kyc: 0-100, sanctions: 0-100,
     * refineryConcentration: 0-1, countryRisk: 0-100 }`. Kept as jsonb so
     * dimensions can evolve without a migration.
     */
    dimensions: jsonb('dimensions').notNull().default({}),
    /** Free-text narrative summary (optional). */
    narrative: text('narrative'),
    /** [{title, detail, priority}] — actionable next steps. */
    recommendations: jsonb('recommendations').notNull().default([]),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Reports older than expires_at MUST be re-generated. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    generatedByModel: text('generated_by_model'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('buyer_risk_reports_tenant_idx').on(t.tenantId),
    buyerIdx: index('buyer_risk_reports_buyer_idx').on(t.buyerId),
    generatedAtIdx: index('buyer_risk_reports_generated_at_idx').on(
      t.tenantId,
      t.buyerId,
      t.generatedAt,
    ),
    riskLevelIdx: index('buyer_risk_reports_level_idx').on(
      t.tenantId,
      t.riskLevel,
    ),
  }),
);

// ============================================================================
// Type re-exports
// ============================================================================

export type BuyerRiskReport = typeof buyerRiskReports.$inferSelect;
export type NewBuyerRiskReport = typeof buyerRiskReports.$inferInsert;

// ============================================================================
// Buyer extension column projections.
//
// The `buyers` table (see production-sales.schema.ts) carries four new
// columns added by migration 0005: credit_limit_tzs, aml_status,
// banking_jsonb, payment_history_jsonb. We do NOT redeclare the table
// here — that would conflict with the canonical definition. Instead we
// expose a typed "view" of the extended columns so callers can pull them
// with `drizzle.select({ ... }).from(buyers)` without losing type
// safety. The repository file in services/domain-services normalises
// these into a `BuyerFinancialProfile` aggregate.
// ============================================================================

export interface BuyerFinancialProfileColumns {
  /** Maximum unsecured exposure in TZS. */
  readonly creditLimitTzs: number | null;
  /** clear|under_review|flagged|blocked. */
  readonly amlStatus: string;
  /**
   * Banking metadata blob — e.g. `{ bankName, accountLast4, swiftBic,
   * verifiedAt }`. Kept as JSON so add-on fields can roll out without a
   * column add.
   */
  readonly bankingJsonb: Readonly<Record<string, unknown>>;
  /**
   * Append-only payment history. Each entry follows the shape
   * `{ saleId, amountTzs, paidAt, method, status }`. Trimmed by a
   * monthly background job once the row exceeds 500 entries.
   */
  readonly paymentHistoryJsonb: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/**
 * AML status ladder. Higher index = more severe. Repository helpers
 * use this to enforce a monotonic transition (e.g. `flagged` cannot be
 * reverted to `clear` without an explicit override).
 */
export const BUYER_AML_STATUSES = [
  'clear',
  'under_review',
  'flagged',
  'blocked',
] as const;
export type BuyerAmlStatus = (typeof BUYER_AML_STATUSES)[number];

/** Numeric helper — returns the relative severity of an AML status. */
export function buyerAmlSeverity(status: BuyerAmlStatus): number {
  return BUYER_AML_STATUSES.indexOf(status);
}
