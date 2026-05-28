/**
 * Risk Scanner — typed shapes.
 *
 * Mirrors the opportunity-scanner architecture (#141) but polarity-
 * flipped: every rule LOOKS for a threat the owner can mitigate
 * BEFORE it materialises. Headlines and narratives are bilingual; the
 * scanner ranks by severity * 1/timeToImpactDays so the most urgent
 * meaningful threats float to the top of the brain's `mining.risks.scan`
 * call.
 *
 * Rules are pure functions of `RiskScannerState` (a frozen snapshot the
 * scanner gathers up-front). They NEVER throw — when a backing read
 * fails the state field is null and the rule short-circuits to "no
 * signal" via its `detect()` guard.
 *
 * Severity / time-to-impact thresholds are deliberately conservative;
 * the brain prompt requires `severity >= high` OR `timeToImpactDays <=
 * 14` OR `exposureTzs > 10M` to actually surface the risk to the owner.
 */

export type RiskKind =
  | 'cash_flow'
  | 'regulatory'
  | 'operational'
  | 'hr'
  | 'compliance'
  | 'counterparty'
  | 'market'
  | 'estate'
  | 'security'
  | 'reputational'
  | 'tax'
  | 'legal';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BilingualText {
  readonly en: string;
  readonly sw: string;
}

export interface RiskMitigationAction {
  /** Slug action key resolved by the FE / brain tool dispatcher. */
  readonly action: string;
  /** Optional scope id this action applies to (e.g. "geita"). */
  readonly target?: string;
  /** Free-form payload the FE handler interprets. */
  readonly payload?: Record<string, unknown>;
  /** Bilingual button label rendered on the RiskCard. */
  readonly label: BilingualText;
}

/**
 * One risk surfaced to the owner. Same shape the SSE `<risk>` block
 * uses on the wire (server-side parser validates against this).
 */
export interface Risk {
  readonly id: string;
  readonly kind: RiskKind;
  readonly severity: RiskSeverity;
  readonly headline: BilingualText;
  readonly narrative: BilingualText;
  /** Money the owner is exposed to in TZS. Null when not quantifiable. */
  readonly exposureTzs: number | null;
  /** Days until the risk materialises if no mitigation lands. */
  readonly timeToImpactDays: number;
  readonly mitigationActions: ReadonlyArray<RiskMitigationAction>;
  /** Scope ids this risk applies to (sites / entities / contracts). */
  readonly relatedScopes: ReadonlyArray<string>;
  /** Evidence ids the brain can cite (LMBM / corpus chunk ids). */
  readonly citations: ReadonlyArray<string>;
  /** Stable rule id so dedup / acknowledge can target this risk later. */
  readonly ruleId: string;
}

/**
 * Snapshot of state the scanner gathers BEFORE rules evaluate. Every
 * field is optional — when a resolver returns null the rule simply
 * declines to trigger. Numbers default to zero, dates default to null.
 *
 * This is the ONLY data surface a rule may read; it must NOT close over
 * a DB client so unit tests can hand-craft state without mocking
 * Drizzle. The scanner module owns the resolver-to-state mapping.
 */
export interface RiskScannerState {
  readonly tenantId: string;
  readonly nowIso: string;

  // Cash flow
  readonly cashRunwayDays: number | null;
  readonly arOverdue60dPctOfMonthly: number | null;
  readonly payrollDueInDays: number | null;
  readonly payrollAmountTzs: number | null;
  readonly cashOnHandTzs: number | null;

  // Regulatory
  readonly nemcEiaDaysToExpiry: number | null;
  readonly botExportLicenceDaysToExpiry: number | null;
  readonly traFilingDaysOverdue: number | null;
  readonly traPenaltyAccrualTzs: number | null;

  // Operational
  readonly productionMomMonthsDown: number;
  readonly productionMomDeltaPct: number | null;
  readonly fuelDaysRemaining: number | null;
  readonly equipmentRepeatFailures: ReadonlyArray<{
    readonly equipmentKind: string;
    readonly count: number;
    readonly windowDays: number;
  }>;

  // HR
  readonly supervisorAttrition90d: number;
  readonly operatorsWithExpiredIcaActive: number;

  // Compliance
  readonly royaltyDraftPctDeviation: number | null;
  readonly nemcAmber: boolean;
  readonly oshaAmber: boolean;
  readonly openIncidents: number;

  // Counterparty
  readonly buyerLatePayments: ReadonlyArray<{
    readonly buyerId: string;
    readonly buyerName: string;
    readonly latePaymentCount: number;
    readonly crbScoreDelta: number | null;
  }>;
  readonly supplierQualityIssues: ReadonlyArray<{
    readonly supplierId: string;
    readonly supplierName: string;
    readonly offSpecCount: number;
  }>;

  // Market
  readonly lbmaFixDelta30dSigma: number | null;
  readonly fxUsdTzsVolatilityPctIntraday: number | null;
  readonly monthlyRevenueTzs: number | null;

  // Estate
  readonly successionReviewOverdueDays: number | null;
  readonly principalOwnerAgeYears: number | null;
  readonly insurancePoliciesExpiring30d: ReadonlyArray<{
    readonly policyId: string;
    readonly policyKind: string;
    readonly daysToExpiry: number;
  }>;

  // Security
  readonly accessAnomaliesLastHour: number;
  readonly failedAuthSpike: number;
  readonly suspiciousActionCount: number;

  // Reputational
  readonly csrGrievances60d: number;
  readonly cdaMilestonesOverdue: number;

  // Tax
  readonly withholdingTaxPayableTzs: number | null;
  readonly withholdingProvisionTzs: number | null;
  readonly traInquiryOpen: boolean;
  readonly traFilingOverdueDays: number | null;

  // Legal
  readonly top3ContractsExpiring60d: ReadonlyArray<{
    readonly contractId: string;
    readonly counterpartyName: string;
    readonly daysToExpiry: number;
    readonly annualValueTzs: number | null;
    readonly hasRenewalInFlight: boolean;
  }>;
  readonly disputeEscalations: ReadonlyArray<{
    readonly counterpartyId: string;
    readonly counterpartyName: string;
    readonly disputeCount90d: number;
  }>;

  // Site / scope context for relatedScopes population
  readonly knownScopes: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
}

/**
 * Rule contract — pure function of state. `detect()` returns true when
 * the rule fires; `evaluate()` produces the structured Risk for the
 * scanner to rank. evaluate must NOT be called when detect returned
 * false (the scanner enforces this).
 */
export interface RiskRule {
  readonly id: string;
  readonly kind: RiskKind;
  readonly severity: RiskSeverity;
  /** Lower bound for time-to-impact (days). Rule may override per-evaluate. */
  readonly defaultTimeToImpactDays: number;
  detect(state: RiskScannerState): boolean;
  evaluate(state: RiskScannerState): Risk;
}

/** Input options for `scanRisks()`. */
export interface ScanRisksOptions {
  /** Cap on the number of risks surfaced (default 5). */
  readonly limit?: number;
  /** When set, only rules whose kind matches are evaluated. */
  readonly kindFilter?: ReadonlyArray<RiskKind>;
  /** When set, drop risks whose severity ranks below this. */
  readonly minSeverity?: RiskSeverity;
  /** When set, restrict to risks whose relatedScopes intersect. */
  readonly scopeIds?: ReadonlyArray<string>;
}

/**
 * Map a severity to a numeric weight for the ranking formula.
 * critical > high > medium > low. Exposed so tests can pin the order.
 */
export const SEVERITY_WEIGHT: Readonly<Record<RiskSeverity, number>> = Object.freeze({
  low: 1,
  medium: 3,
  high: 7,
  critical: 12,
});

/**
 * Rank score used to order risks: severity weight divided by max(1, ttd).
 * Higher = more urgent. Ties broken by exposureTzs then id (stable).
 */
export function scoreRisk(risk: Risk): number {
  const ttd = Math.max(1, risk.timeToImpactDays);
  return SEVERITY_WEIGHT[risk.severity] / ttd;
}
