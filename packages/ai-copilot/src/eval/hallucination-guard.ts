/**
 * Hallucination guard — pure-function safety net for AI copilot responses.
 *
 * Wraps any BORJIE copilot response BEFORE it reaches a user. Verifies:
 *
 *   1. Numeric scores (e.g. tenant credit score, property grade) fall
 *      inside declared bounds.
 *   2. Cited reason codes belong to the active reason-code allow-list
 *      (e.g. credit adverse-action codes, eviction reason codes).
 *   3. Cited regulations exist in the regulation registry (e.g.
 *      "KE-RentRestrictionAct-Cap296-§6", "TZ-LandLandlordTenantAct-§32").
 *   4. For analytical (DB-grounded) answers, every quoted number is
 *      present in the provided result set (rent figures, deposits,
 *      occupancy %, etc.).
 *   5. For action calls, the tool exists in the active tool registry.
 *   6. Property-management-specific bounds: rent in jurisdictional range,
 *      deposit cap not exceeded, eviction notice period not below
 *      statutory minimum.
 *
 * Returns { verified, issues }. An unverified response MUST be HELD by
 * the caller (queue, do not display) and surfaced for review.
 *
 * Ported from:
 *   LITFIN PROJECT/src/core/safety/hallucination-guard.ts
 *
 * Property-management-specific adaptations:
 *   - Renamed `analytical` semantics preserved; added jurisdiction-aware
 *     rent/deposit/notice-period bounds.
 *   - Added per-jurisdiction `PropertyMgmtBounds` injectable so the guard
 *     stays pure (no compliance-plugin import — caller supplies bounds).
 */

// --- Severity + issue codes --------------------------------------------------

export type GuardSeverity = 'low' | 'medium' | 'high' | 'critical';

export type GuardIssueCode =
  | 'score_out_of_bounds'
  | 'unknown_reason_code'
  | 'unknown_regulation'
  | 'unsupported_number'
  | 'unknown_tool'
  | 'missing_citation'
  | 'rent_out_of_range'
  | 'deposit_cap_exceeded'
  | 'notice_period_below_min'
  | 'unknown_jurisdiction';

export interface GuardIssue {
  readonly code: GuardIssueCode;
  readonly severity: GuardSeverity;
  readonly detail: string;
}

export interface GuardResult {
  readonly verified: boolean;
  readonly issues: readonly GuardIssue[];
}

// --- Property-management bound types -----------------------------------------

/** ISO-3166-1 alpha-2 jurisdiction code used by BORJIE. */
export type JurisdictionCode = 'TZ' | 'KE' | 'UG' | 'NG' | string;

/**
 * Per-jurisdiction property-management bounds. Inputs in *minor* currency
 * units (cents/shilingi-cents) where applicable, to avoid float drift.
 *
 * Real values are sourced from @borjie/compliance-plugins. We inject
 * them rather than import to keep this module pure and testable.
 */
export interface PropertyMgmtBounds {
  readonly jurisdiction: JurisdictionCode;
  /** Currency code (e.g. "TZS", "KES"). For diagnostic detail only. */
  readonly currency: string;
  /** Minimum monthly rent (minor units). Helps catch off-by-1000 hallucinations. */
  readonly minRentMinorUnits: number;
  /** Maximum monthly rent (minor units). Helps catch off-by-1000 hallucinations. */
  readonly maxRentMinorUnits: number;
  /** Max deposit as months of rent (residential, statutory cap). */
  readonly maxDepositMonths: number;
  /** Minimum statutory eviction notice period in days (most-protective reason). */
  readonly minEvictionNoticeDays: number;
}

// --- Brain response + context -----------------------------------------------

/**
 * Quoted property-management claim the copilot is making. Each field is
 * optional — only declared claims are verified.
 */
export interface PropertyMgmtClaim {
  /** Monthly rent quoted, minor units. */
  readonly monthlyRentMinorUnits?: number;
  /** Deposit quoted (minor units) AND the monthly rent it should be measured against. */
  readonly depositMinorUnits?: number;
  /** Notice period (days) the copilot is recommending. */
  readonly evictionNoticeDays?: number;
  /** Jurisdiction the claim applies to. Must match a bounds entry. */
  readonly jurisdiction?: JurisdictionCode;
}

export interface BrainResponse {
  /** Free-text shown to the user — checked for unsupported numbers + citations. */
  readonly text: string;
  /** Score the brain claims (0..max). Optional. */
  readonly score?: number;
  /** Maximum value of `score`. Default 100. */
  readonly scoreMax?: number;
  /** Adverse-action / eviction / screening reason codes claimed. */
  readonly reasonCodes?: readonly string[];
  /** Regulation citations (e.g. "KE-RentRestrictionAct-Cap296-§6"). */
  readonly regulationCitations?: readonly string[];
  /** Tool the brain wants to call. */
  readonly toolCall?: { name: string; args: Record<string, unknown> };
  /** Numeric values the brain quoted from the DB. */
  readonly quotedNumbers?: readonly number[];
  /** Whether the brain claims to be answering an analytical (DB) question. */
  readonly analytical?: boolean;
  /** Property-management-specific claim verified against PropertyMgmtBounds. */
  readonly propertyClaim?: PropertyMgmtClaim;
}

export interface GuardContext {
  readonly allowedReasonCodes: readonly string[];
  readonly regulationRegistry: readonly string[];
  readonly toolRegistry: readonly string[];
  /** Numbers actually returned by the DB query. */
  readonly dbResultNumbers?: readonly number[];
  /** Equality tolerance for floating-point compares (default 1e-6). */
  readonly numericTolerance?: number;
  /** Per-jurisdiction property-management bounds, keyed by jurisdiction code. */
  readonly propertyMgmtBounds?: Readonly<Record<JurisdictionCode, PropertyMgmtBounds>>;
}

// --- Internals ---------------------------------------------------------------

const DEFAULT_TOLERANCE = 1e-6;

function approxIncludes(
  haystack: readonly number[],
  needle: number,
  tol: number,
): boolean {
  return haystack.some((h) => Math.abs(h - needle) <= tol);
}

function verifyPropertyClaim(
  claim: PropertyMgmtClaim,
  bounds: Readonly<Record<JurisdictionCode, PropertyMgmtBounds>> | undefined,
  issues: GuardIssue[],
): void {
  const jx = claim.jurisdiction;
  if (!jx) return;

  const b = bounds?.[jx];
  if (!b) {
    issues.push({
      code: 'unknown_jurisdiction',
      severity: 'high',
      detail: `jurisdiction ${jx} has no bounds configured`,
    });
    return;
  }

  // Rent range — guards against off-by-1000 hallucinations.
  if (typeof claim.monthlyRentMinorUnits === 'number') {
    const r = claim.monthlyRentMinorUnits;
    if (
      Number.isNaN(r) ||
      r < b.minRentMinorUnits ||
      r > b.maxRentMinorUnits
    ) {
      issues.push({
        code: 'rent_out_of_range',
        severity: 'high',
        detail: `rent=${r} ${b.currency}-minor outside [${b.minRentMinorUnits}, ${b.maxRentMinorUnits}] for ${jx}`,
      });
    }
  }

  // Deposit cap — months of rent.
  if (
    typeof claim.depositMinorUnits === 'number' &&
    typeof claim.monthlyRentMinorUnits === 'number' &&
    claim.monthlyRentMinorUnits > 0
  ) {
    const months = claim.depositMinorUnits / claim.monthlyRentMinorUnits;
    if (months > b.maxDepositMonths) {
      issues.push({
        code: 'deposit_cap_exceeded',
        severity: 'critical',
        detail: `deposit=${months.toFixed(2)} months exceeds statutory cap ${b.maxDepositMonths} for ${jx}`,
      });
    }
  }

  // Eviction notice — below statutory minimum is a critical fail.
  if (typeof claim.evictionNoticeDays === 'number') {
    if (claim.evictionNoticeDays < b.minEvictionNoticeDays) {
      issues.push({
        code: 'notice_period_below_min',
        severity: 'critical',
        detail: `notice=${claim.evictionNoticeDays}d below statutory minimum ${b.minEvictionNoticeDays}d for ${jx}`,
      });
    }
  }
}

// --- Public API --------------------------------------------------------------

export function verifyResponse(
  response: BrainResponse,
  context: GuardContext,
): GuardResult {
  const issues: GuardIssue[] = [];
  const tol = context.numericTolerance ?? DEFAULT_TOLERANCE;

  // 1. Score bounds
  if (typeof response.score === 'number') {
    const max = response.scoreMax ?? 100;
    if (
      response.score < 0 ||
      response.score > max ||
      Number.isNaN(response.score)
    ) {
      issues.push({
        code: 'score_out_of_bounds',
        severity: 'critical',
        detail: `score=${response.score} outside [0, ${max}]`,
      });
    }
  }

  // 2. Reason codes
  for (const code of response.reasonCodes ?? []) {
    if (!context.allowedReasonCodes.includes(code)) {
      issues.push({
        code: 'unknown_reason_code',
        severity: 'high',
        detail: `${code} not in reason-code allow-list`,
      });
    }
  }

  // 3. Regulation citations
  for (const cite of response.regulationCitations ?? []) {
    if (!context.regulationRegistry.includes(cite)) {
      issues.push({
        code: 'unknown_regulation',
        severity: 'high',
        detail: `${cite} not in regulation registry`,
      });
    }
  }

  // 4. Numeric grounding for analytical answers
  if (response.analytical) {
    if (!context.dbResultNumbers || context.dbResultNumbers.length === 0) {
      issues.push({
        code: 'unsupported_number',
        severity: 'critical',
        detail: 'analytical answer with no DB result-set provided',
      });
    } else {
      for (const n of response.quotedNumbers ?? []) {
        if (!approxIncludes(context.dbResultNumbers, n, tol)) {
          issues.push({
            code: 'unsupported_number',
            severity: 'high',
            detail: `quoted ${n} not present in DB result-set`,
          });
        }
      }
    }
  }

  // 5. Tool existence
  if (response.toolCall) {
    if (!context.toolRegistry.includes(response.toolCall.name)) {
      issues.push({
        code: 'unknown_tool',
        severity: 'critical',
        detail: `tool ${response.toolCall.name} not registered`,
      });
    }
  }

  // 6. Citation discipline — if response cites a reason or regulation
  //    but the text is empty, flag as missing citation context.
  if (
    (response.reasonCodes?.length ?? 0) +
      (response.regulationCitations?.length ?? 0) >
      0 &&
    response.text.trim().length === 0
  ) {
    issues.push({
      code: 'missing_citation',
      severity: 'medium',
      detail: 'citations present but no surrounding text',
    });
  }

  // 7. Property-management bounds
  if (response.propertyClaim) {
    verifyPropertyClaim(
      response.propertyClaim,
      context.propertyMgmtBounds,
      issues,
    );
  }

  return {
    verified: issues.length === 0,
    issues,
  };
}

/**
 * Wraps a brain function so unverified responses are HELD (returned to
 * the caller as `{ held: true }`) rather than shown to the user.
 */
export interface GuardedDelivery<T extends BrainResponse> {
  readonly held: boolean;
  readonly response?: T;
  readonly issues: readonly GuardIssue[];
}

export function guardDeliver<T extends BrainResponse>(
  response: T,
  context: GuardContext,
): GuardedDelivery<T> {
  const result = verifyResponse(response, context);
  if (result.verified) {
    return { held: false, response, issues: [] };
  }
  return { held: true, issues: result.issues };
}

// --- Pre-built jurisdictional defaults --------------------------------------

/**
 * Sensible defaults for BORJIE's primary jurisdictions. Callers can
 * import these and merge with workspace overrides. Bounds sourced from
 * @borjie/compliance-plugins (kept in sync manually; review when
 * statutory rules change).
 *
 * Rent ranges are *advisory* — they catch obvious hallucinations
 * (rent=10 KES, rent=99,999,999 KES). Real underwriting still does
 * per-property valuation.
 */
export const DEFAULT_PROPERTY_MGMT_BOUNDS: Readonly<
  Record<JurisdictionCode, PropertyMgmtBounds>
> = Object.freeze({
  TZ: Object.freeze({
    jurisdiction: 'TZ',
    currency: 'TZS',
    // 50_000 TZS to 50_000_000 TZS per month, in cents.
    minRentMinorUnits: 50_000 * 100,
    maxRentMinorUnits: 50_000_000 * 100,
    // Land (Landlord and Tenant) Act §32 — residential cap.
    maxDepositMonths: 6,
    // Most protective: end-of-term renewal non-continuation = 90 days.
    minEvictionNoticeDays: 14,
  }),
  KE: Object.freeze({
    jurisdiction: 'KE',
    currency: 'KES',
    minRentMinorUnits: 3_000 * 100,
    maxRentMinorUnits: 5_000_000 * 100,
    // Rent Restriction Act (Cap 296) §6.
    maxDepositMonths: 3,
    // Distress for Rent Act — non-payment notice 14d; nuisance 7d.
    minEvictionNoticeDays: 7,
  }),
  UG: Object.freeze({
    jurisdiction: 'UG',
    currency: 'UGX',
    minRentMinorUnits: 50_000 * 100,
    maxRentMinorUnits: 100_000_000 * 100,
    // Landlord and Tenant Act 2022 §13 — residential cap.
    maxDepositMonths: 3,
    // Nuisance / illegal-use: 7 days under LTA 2022.
    minEvictionNoticeDays: 7,
  }),
  NG: Object.freeze({
    jurisdiction: 'NG',
    currency: 'NGN',
    minRentMinorUnits: 5_000 * 100,
    maxRentMinorUnits: 500_000_000 * 100,
    // Lagos Tenancy Law 2011 §4(3) — no more than one year upfront.
    maxDepositMonths: 12,
    // Lagos Tenancy Law — non-payment 7 days; nuisance 7 days.
    minEvictionNoticeDays: 7,
  }),
});
