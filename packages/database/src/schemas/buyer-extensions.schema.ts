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

// ============================================================================
// Buyer self-signup extension columns (migration 0087)
//
// Companion to `services/api-gateway/src/routes/buyers/signup.hono.ts`. The
// `buyers` Drizzle table (canonical definition in production-sales.schema.ts)
// is NOT redeclared here — adding fields a second time would conflict at
// runtime. Instead we expose:
//
//   * A typed view of the new columns so the signup route can build a
//     well-typed insert payload via the canonical `buyers` import.
//   * The discriminated-union enums + KYC atom catalogues that the route
//     handler, the workforce/buyer mobile clients, and the compliance
//     plugins all share — single source of truth on what an INDIVIDUAL vs
//     a BUSINESS buyer must complete before they can place bids.
// ============================================================================

/** Top-level discriminator — INDIVIDUAL (personal) vs BUSINESS (org). */
export const BUYER_ACCOUNT_KINDS = ['individual', 'business'] as const;
export type BuyerAccountKind = (typeof BUYER_ACCOUNT_KINDS)[number];

/** Sub-type when account_kind = 'business'. */
export const BUYER_BUSINESS_KINDS = [
  'refiner',
  'broker',
  'fabricator',
  'investor',
  'other',
] as const;
export type BuyerBusinessKind = (typeof BUYER_BUSINESS_KINDS)[number];

/** Jurisdictions accepted at buyer signup time. */
export const BUYER_COUNTRY_CODES = [
  'TZ',
  'KE',
  'UG',
  'NG',
  'CN',
  'IN',
  'AE',
  'EU',
  'OTHER',
] as const;
export type BuyerCountryCode = (typeof BUYER_COUNTRY_CODES)[number];

/** Buyer-side display currencies. Authoritative money still lives in
 *  payments-ledger; this is the preferred render unit. */
export const BUYER_CURRENCY_CODES = [
  'USD',
  'TZS',
  'KES',
  'EUR',
  'CNY',
  'INR',
] as const;
export type BuyerCurrencyCode = (typeof BUYER_CURRENCY_CODES)[number];

/** Per the Swahili-first hard rule, `sw` is the default. */
export const BUYER_LANGUAGE_CODES = ['sw', 'en'] as const;
export type BuyerLanguageCode = (typeof BUYER_LANGUAGE_CODES)[number];

/** Lifecycle a buyer's KYC moves through under the atom chain. */
export const BUYER_KYC_STATUSES = [
  'not_started',
  'in_progress',
  'partial',
  'verified',
  'rejected',
] as const;
export type BuyerKycStatus = (typeof BUYER_KYC_STATUSES)[number];

/**
 * KYC atoms required for an INDIVIDUAL buyer. Chunked, progressive — the
 * buyer mobile wizard walks them in order but allows skipping
 * non-blocking atoms (the compliance plugin reads `kyc_atoms_completed`
 * and decides which gate to lift).
 */
export const BUYER_KYC_ATOMS_INDIVIDUAL = [
  'identity',
  'address',
  'bank_account',
  'source_of_funds',
] as const;
export type BuyerKycAtomIndividual =
  (typeof BUYER_KYC_ATOMS_INDIVIDUAL)[number];

/**
 * KYC atoms required for a BUSINESS buyer (refiner / broker / fabricator /
 * investor). Deeper than individual — adds company docs, tax compliance,
 * beneficial owners, AML screening.
 */
export const BUYER_KYC_ATOMS_BUSINESS = [
  'identity',
  'address',
  'company_docs',
  'tax_compliance',
  'bank_account',
  'beneficial_owners',
  'aml_screening',
] as const;
export type BuyerKycAtomBusiness = (typeof BUYER_KYC_ATOMS_BUSINESS)[number];

export type BuyerKycAtom = BuyerKycAtomIndividual | BuyerKycAtomBusiness;

/**
 * Initial atom list a buyer must work through given their account kind.
 * Single source of truth — every consumer (signup route, mobile wizard,
 * admin-console review queue) reads the same list.
 */
export function initialKycAtomsFor(
  kind: BuyerAccountKind,
): ReadonlyArray<BuyerKycAtom> {
  return kind === 'individual'
    ? BUYER_KYC_ATOMS_INDIVIDUAL
    : BUYER_KYC_ATOMS_BUSINESS;
}

/**
 * Typed projection of the new `buyers` columns added by migration 0087.
 * Used as a builder type — the route handler composes an insert payload
 * conforming to this shape, then merges it with the canonical `buyers`
 * insert (which carries the pre-existing columns).
 */
export interface BuyerSignupColumns {
  readonly accountKind: BuyerAccountKind;
  readonly businessKind: BuyerBusinessKind | null;
  readonly orgName: string | null;
  readonly preferredCurrency: BuyerCurrencyCode;
  readonly preferredLanguage: BuyerLanguageCode;
  readonly fullName: string;
  readonly nationalIdNumber: string | null;
  readonly taxId: string | null;
  readonly businessRegistrationNumber: string | null;
  readonly kycAtomsCompleted: ReadonlyArray<BuyerKycAtom>;
  readonly walletBalanceMinor: number;
  readonly bidLimitMinor: number;
}
