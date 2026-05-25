/**
 * LeaseLawPort — jurisdiction-specific lease-law knowledge.
 *
 * The existing `CompliancePolicy` covers coarse numerics (min/max deposit,
 * generic notice period). This port adds:
 *   - the STRUCTURED list of clauses a lease in this jurisdiction MUST
 *     contain (useful for lease-template validators),
 *   - notice-window resolution by termination REASON (eviction for
 *     non-payment differs from notice for renewal non-continuation),
 *   - deposit-cap expressed flexibly (months OR absolute-weeks-of-rent,
 *     OR one-month-cap as in NY),
 *   - rent-increase caps (percentage or CPI-indexed).
 */

/** Lease kind — residential vs commercial drives different statutes. */
export type LeaseKind = 'residential' | 'commercial' | 'short-let';

/**
 * Reasons a party gives notice. Names align with common property-
 * management vocabulary across jurisdictions.
 */
export type NoticeReason =
  | 'non-payment'
  | 'end-of-term'
  | 'landlord-repossession'
  | 'breach-of-covenant'
  | 'renewal-non-continuation'
  | 'illegal-use'
  | 'nuisance';

/** Deposit-cap expression forms seen across jurisdictions. */
export type DepositCapRegime =
  | 'residential-standard'
  | 'residential-rent-controlled'
  | 'commercial';

export interface ClauseSpec {
  /** Stable machine ID (e.g. 'rent-amount', 'deposit-return-window'). */
  readonly id: string;
  /** Human label rendered in the lease-template validator. */
  readonly label: string;
  /** True if missing the clause renders the lease unenforceable. */
  readonly mandatory: boolean;
  /** One-sentence regulator citation or rationale. */
  readonly citation: string;
}

export interface DepositCap {
  /** Upper bound expressed as whole months of rent — preferred form. */
  readonly maxMonthsOfRent?: number;
  /** Upper bound expressed in weeks-of-rent (UK Tenant Fees Act). */
  readonly maxWeeksOfRent?: number;
  /** Absolute cap in minor units (rare — e.g. some NY contexts). */
  readonly absoluteMaxMinorUnits?: number;
  /** Regulator / statute reference. */
  readonly citation: string;
}

export interface RentIncreaseCap {
  /** Maximum annual percentage increase allowed, if any. */
  readonly pctPerAnnum?: number;
  /** Set when the cap is indexed to a public series. */
  readonly indexedTo?: 'CPI' | 'RPI' | 'LOCAL_INDEX';
  /** Free-form regulator / statute reference. */
  readonly citation: string;
}

export interface LeaseLawPort {
  /** Clauses that a lease of this kind MUST contain. */
  requiredClauses(leaseKind: LeaseKind): readonly ClauseSpec[];
  /**
   * Statutory notice-window in calendar days for the given reason. Returns
   * `null` when the jurisdiction has no fixed window — consumers fall back
   * to the lease agreement.
   */
  noticeWindowDays(reason: NoticeReason): number | null;
  /** Deposit cap under a specific regime. */
  depositCapMultiple(regime: DepositCapRegime): DepositCap;
  /** Rent-increase cap applied in this jurisdiction. */
  rentIncreaseCap(regime: DepositCapRegime): RentIncreaseCap;
}

// ---------------------------------------------------------------------------
// Default — returns empty / null with "CONFIGURE" citations.
// ---------------------------------------------------------------------------

const NOT_CONFIGURED_CITATION =
  'CONFIGURE_FOR_YOUR_JURISDICTION: no lease-law rules registered — consult counsel.';

export const DEFAULT_LEASE_LAW: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    // Universal-minimum residential clauses that apply everywhere.
    return Object.freeze([
      {
        id: 'parties',
        label: 'Names and addresses of landlord and tenant',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'premises',
        label: 'Description of the leased premises',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'rent-amount',
        label: 'Rent amount, due date, and payment method',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'term',
        label: 'Lease term with start and end dates',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
    ]);
  },
  noticeWindowDays(_reason) {
    return null;
  },
  depositCapMultiple(_regime) {
    return {
      citation: NOT_CONFIGURED_CITATION,
    };
  },
  rentIncreaseCap(_regime) {
    return {
      citation: NOT_CONFIGURED_CITATION,
    };
  },
};
