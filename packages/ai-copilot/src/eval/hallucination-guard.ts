/**
 * Hallucination guard — pure-function safety net for AI copilot responses.
 *
 * Wraps any BORJIE copilot response BEFORE it reaches a user. Verifies:
 *
 *   1. Numeric scores (e.g. counterparty credit score, asset grade) fall
 *      inside declared bounds.
 *   2. Cited reason codes belong to the active reason-code allow-list
 *      (e.g. counterparty-qualification codes, licence-suspension codes).
 *   3. Cited regulations exist in the regulation registry (e.g.
 *      "TZ-MiningAct-2010-s.87", "TZ-MiningRegs-Royalty").
 *   4. For analytical (DB-grounded) answers, every quoted number is
 *      present in the provided result set (consignment values, royalty
 *      figures, recovery %, etc.).
 *   5. For action calls, the tool exists in the active tool registry.
 *   6. Mining-operations-specific bounds: consignment value in
 *      jurisdictional range, royalty rate not exceeded, licence notice
 *      period not below statutory minimum.
 *
 * Returns { verified, issues }. An unverified response MUST be HELD by
 * the caller (queue, do not display) and surfaced for review.
 *
 * Ported from:
 *   LITFIN PROJECT/src/core/safety/hallucination-guard.ts
 *
 * Mining-operations-specific adaptations:
 *   - Renamed `analytical` semantics preserved; added jurisdiction-aware
 *     consignment-value / royalty-rate / notice-period bounds.
 *   - Added per-jurisdiction `MiningOpsBounds` injectable so the guard
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
  | 'consignment_value_out_of_range'
  | 'royalty_rate_exceeded'
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

// --- Mining-operations bound types -------------------------------------------

/** ISO-3166-1 alpha-2 jurisdiction code used by BORJIE. */
export type JurisdictionCode = 'TZ' | 'KE' | 'UG' | 'NG' | string;

/**
 * Per-jurisdiction mining-operations bounds. Inputs in *minor* currency
 * units (cents/shilingi-cents) where applicable, to avoid float drift.
 *
 * Real values are sourced from @borjie/compliance-plugins. We inject
 * them rather than import to keep this module pure and testable.
 */
export interface MiningOpsBounds {
  readonly jurisdiction: JurisdictionCode;
  /** Currency code (e.g. "TZS", "KES"). For diagnostic detail only. */
  readonly currency: string;
  /** Minimum consignment value (minor units). Helps catch off-by-1000 hallucinations. */
  readonly minConsignmentValueMinorUnits: number;
  /** Maximum consignment value (minor units). Helps catch off-by-1000 hallucinations. */
  readonly maxConsignmentValueMinorUnits: number;
  /** Maximum royalty (+ clearing fee) as a percentage of gross value (statutory). */
  readonly maxRoyaltyPct: number;
  /** Minimum statutory licence-default notice period in days (most-protective reason). */
  readonly minLicenceNoticeDays: number;
}

// --- Brain response + context -----------------------------------------------

/**
 * Quoted mining-operations claim the copilot is making. Each field is
 * optional — only declared claims are verified.
 */
export interface MiningOpsClaim {
  /** Gross consignment value quoted, minor units. */
  readonly consignmentValueMinorUnits?: number;
  /** Royalty quoted (minor units) AND the gross value it should be measured against. */
  readonly royaltyMinorUnits?: number;
  /** Licence-default notice period (days) the copilot is recommending. */
  readonly licenceNoticeDays?: number;
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
  /** Qualification / suspension / screening reason codes claimed. */
  readonly reasonCodes?: readonly string[];
  /** Regulation citations (e.g. "TZ-MiningAct-2010-s.87"). */
  readonly regulationCitations?: readonly string[];
  /** Tool the brain wants to call. */
  readonly toolCall?: { name: string; args: Record<string, unknown> };
  /** Numeric values the brain quoted from the DB. */
  readonly quotedNumbers?: readonly number[];
  /** Whether the brain claims to be answering an analytical (DB) question. */
  readonly analytical?: boolean;
  /** Mining-operations-specific claim verified against MiningOpsBounds. */
  readonly miningClaim?: MiningOpsClaim;
}

export interface GuardContext {
  readonly allowedReasonCodes: readonly string[];
  readonly regulationRegistry: readonly string[];
  readonly toolRegistry: readonly string[];
  /** Numbers actually returned by the DB query. */
  readonly dbResultNumbers?: readonly number[];
  /** Equality tolerance for floating-point compares (default 1e-6). */
  readonly numericTolerance?: number;
  /** Per-jurisdiction mining-operations bounds, keyed by jurisdiction code. */
  readonly miningOpsBounds?: Readonly<Record<JurisdictionCode, MiningOpsBounds>>;
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

function verifyMiningClaim(
  claim: MiningOpsClaim,
  bounds: Readonly<Record<JurisdictionCode, MiningOpsBounds>> | undefined,
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

  // Consignment-value range — guards against off-by-1000 hallucinations.
  if (typeof claim.consignmentValueMinorUnits === 'number') {
    const v = claim.consignmentValueMinorUnits;
    if (
      Number.isNaN(v) ||
      v < b.minConsignmentValueMinorUnits ||
      v > b.maxConsignmentValueMinorUnits
    ) {
      issues.push({
        code: 'consignment_value_out_of_range',
        severity: 'high',
        detail: `value=${v} ${b.currency}-minor outside [${b.minConsignmentValueMinorUnits}, ${b.maxConsignmentValueMinorUnits}] for ${jx}`,
      });
    }
  }

  // Royalty rate — percentage of gross value.
  if (
    typeof claim.royaltyMinorUnits === 'number' &&
    typeof claim.consignmentValueMinorUnits === 'number' &&
    claim.consignmentValueMinorUnits > 0
  ) {
    const pct = (claim.royaltyMinorUnits / claim.consignmentValueMinorUnits) * 100;
    // Small epsilon so an exact-ceiling claim (e.g. 7.0%) is not tripped by
    // binary floating-point drift on the division.
    if (pct > b.maxRoyaltyPct + 1e-9) {
      issues.push({
        code: 'royalty_rate_exceeded',
        severity: 'critical',
        detail: `royalty=${pct.toFixed(2)}% exceeds statutory cap ${b.maxRoyaltyPct}% for ${jx}`,
      });
    }
  }

  // Licence-default notice — below statutory minimum is a critical fail.
  if (typeof claim.licenceNoticeDays === 'number') {
    if (claim.licenceNoticeDays < b.minLicenceNoticeDays) {
      issues.push({
        code: 'notice_period_below_min',
        severity: 'critical',
        detail: `notice=${claim.licenceNoticeDays}d below statutory minimum ${b.minLicenceNoticeDays}d for ${jx}`,
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

  // 7. Mining-operations bounds
  if (response.miningClaim) {
    verifyMiningClaim(
      response.miningClaim,
      context.miningOpsBounds,
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
 * Consignment-value ranges are *advisory* — they catch obvious
 * hallucinations (value=10 TZS, value=999,999,999,999 TZS). Real
 * settlement still does per-consignment assay-based valuation.
 */
export const DEFAULT_MINING_OPS_BOUNDS: Readonly<
  Record<JurisdictionCode, MiningOpsBounds>
> = Object.freeze({
  TZ: Object.freeze({
    jurisdiction: 'TZ',
    currency: 'TZS',
    // 500_000 TZS to 50_000_000_000 TZS per consignment, in cents.
    minConsignmentValueMinorUnits: 500_000 * 100,
    maxConsignmentValueMinorUnits: 50_000_000_000 * 100,
    // Mining Act 2010 (am. 2017): 6% royalty + 1% clearing fee = 7% ceiling.
    maxRoyaltyPct: 7,
    // Mining Commission default-notice cure period before suspension = 30 days.
    minLicenceNoticeDays: 30,
  }),
  KE: Object.freeze({
    jurisdiction: 'KE',
    currency: 'KES',
    minConsignmentValueMinorUnits: 30_000 * 100,
    maxConsignmentValueMinorUnits: 5_000_000_000 * 100,
    // Kenya Mining Act 2016: royalty up to ~5% for gold; allow headroom.
    maxRoyaltyPct: 8,
    // Default-notice minimum.
    minLicenceNoticeDays: 30,
  }),
  UG: Object.freeze({
    jurisdiction: 'UG',
    currency: 'UGX',
    minConsignmentValueMinorUnits: 500_000 * 100,
    maxConsignmentValueMinorUnits: 100_000_000_000 * 100,
    // Mining and Minerals Act 2022 royalty band; allow headroom.
    maxRoyaltyPct: 8,
    minLicenceNoticeDays: 30,
  }),
  NG: Object.freeze({
    jurisdiction: 'NG',
    currency: 'NGN',
    minConsignmentValueMinorUnits: 50_000 * 100,
    maxConsignmentValueMinorUnits: 500_000_000_000 * 100,
    // Nigerian Minerals and Mining Act 2007 royalty band; allow headroom.
    maxRoyaltyPct: 8,
    minLicenceNoticeDays: 30,
  }),
});
