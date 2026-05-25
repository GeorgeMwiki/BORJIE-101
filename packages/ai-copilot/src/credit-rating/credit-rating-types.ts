/**
 * Tenant Credit Rating — shared types.
 *
 * FICO-inspired 300-850 numeric scale with letter grade (A/B/C/D/F) and
 * CRB-aligned band (excellent/good/fair/poor/very_poor). The rating is
 * computed from LIVE payment data only — never mocked. When input history
 * is too thin the scorer returns band='insufficient_data' with a reason.
 *
 * Feeds two surfaces:
 *   1. Internal landlord risk tool (admin-portal TenantCredit page).
 *   2. Tenant-facing self-service (customer-app /my-credit) — downloadable
 *      portable credit certificate the tenant can share with prospective
 *      landlords or banks under opt-in consent.
 */

export type CreditLetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type CreditBand =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'very_poor'
  | 'insufficient_data';

export type CreditDimensionKey =
  | 'payment_history'
  | 'promise_keeping'
  | 'rent_to_income'
  | 'tenancy_length'
  | 'dispute_history';

export interface CreditDimensionScore {
  /** Normalized 0-1 score for this dimension. */
  readonly score: number;
  /** Weight (0-1) — how much this dimension contributed to composite. */
  readonly weight: number;
  /** One-line human-readable explanation of how this dimension was scored. */
  readonly explanation: string;
}

export interface CreditRatingDimensions {
  readonly payment_history: CreditDimensionScore;
  readonly promise_keeping: CreditDimensionScore;
  readonly rent_to_income: CreditDimensionScore;
  readonly tenancy_length: CreditDimensionScore;
  readonly dispute_history: CreditDimensionScore;
}

export interface CreditRating {
  readonly tenantId: string;
  readonly customerId: string;
  /** FICO-scale 300-850. Null when band=insufficient_data. */
  readonly numericScore: number | null;
  /** Human letter grade A/B/C/D/F. Null when band=insufficient_data. */
  readonly letterGrade: CreditLetterGrade | null;
  readonly band: CreditBand;
  readonly dimensions: CreditRatingDimensions;
  /** Primary factor dragging score down (lowest weighted dimension). */
  readonly weakestFactor: CreditDimensionKey | null;
  /** Primary factor boosting score (highest weighted dimension). */
  readonly strongestFactor: CreditDimensionKey | null;
  readonly recommendations: readonly string[];
  readonly lastComputedAt: string;
  /**
   * How current the underlying payment data is — 'fresh' when newest invoice
   * is within 35 days, 'stale' beyond that. Communicated to UI so stale
   * ratings are flagged.
   */
  readonly dataFreshness: 'fresh' | 'stale' | 'unknown';
  /** Reason for insufficient_data, or null. */
  readonly insufficientDataReason: string | null;
}

/**
 * All scoring inputs — pulled LIVE from payments, invoices, cases, arrears,
 * leases, and financial-profile. Every field is a real count from real
 * records. No defaults baked into the scorer itself.
 */
export interface CreditRatingInputs {
  readonly tenantId: string;
  readonly customerId: string;

  // Payment history (35%)
  readonly totalInvoices: number;
  readonly paidOnTimeCount: number;
  readonly paidLate30DaysCount: number;
  readonly paidLate60DaysCount: number;
  readonly paidLate90PlusCount: number;
  readonly defaultCount: number;

  // Promise keeping (20%)
  readonly extensionsGranted: number;
  readonly extensionsHonored: number;
  readonly installmentAgreementsOffered: number;
  readonly installmentAgreementsHonored: number;

  // Rent-to-income (20%) — ratio 0..N; 0.3 means rent is 30% of income.
  readonly rentToIncomeRatio: number | null;

  // Tenancy length (15%)
  readonly avgTenancyMonths: number;
  readonly activeTenancyCount: number;

  // Dispute / misuse (10%)
  readonly disputeCount: number;
  readonly damageDeductionCount: number;
  readonly subleaseViolationCount: number;

  // Data freshness
  readonly newestInvoiceAt: string | null;
  readonly oldestInvoiceAt: string | null;
  readonly asOf: string;
}

/**
 * Per-tenant configurable weights. Default is FICO-inspired 35/20/20/15/10
 * but landlords may tune via PUT /credit-rating/weights.
 */
export interface GradingWeights {
  readonly payment_history: number;
  readonly promise_keeping: number;
  readonly rent_to_income: number;
  readonly tenancy_length: number;
  readonly dispute_history: number;
}

export const DEFAULT_GRADING_WEIGHTS: GradingWeights = Object.freeze({
  payment_history: 0.35,
  promise_keeping: 0.2,
  rent_to_income: 0.2,
  tenancy_length: 0.15,
  dispute_history: 0.1,
});

export interface CreditRatingHistoryEntry {
  readonly computedAt: string;
  readonly numericScore: number | null;
  readonly letterGrade: CreditLetterGrade | null;
  readonly band: CreditBand;
  readonly dimensionsSummary: Readonly<Record<CreditDimensionKey, number>>;
}

export type PromiseKind = 'extension' | 'installment' | 'lease_amendment';
export type PromiseOutcome = 'on_time' | 'late' | 'defaulted' | 'pending';

export interface PromiseOutcomeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: PromiseKind;
  readonly agreedDate: string;
  readonly dueDate: string;
  readonly actualOutcome: PromiseOutcome;
  readonly delayDays: number;
  readonly notes: string | null;
  readonly recordedAt: string;
}

export interface CreditSharingOptIn {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly shareWithOrg: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly purpose: string;
}
