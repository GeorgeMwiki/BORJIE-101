/**
 * Regulatory rule types — shared shape across all mining jurisdictions.
 *
 * A rule is the unit of "this mining action is constrained by this
 * statute" — the kernel's regulatory-mirror module evaluates
 * `predicate(payload)` and, when it returns `true`, returns the rule's
 * `verdict` plus the `citation` so the agent's output can quote the
 * source-of-truth (Mining Act 2010, Mineral Royalty Regulations, etc.).
 *
 * Verdicts:
 *   - 'refuse' — hard block; the policy gate refuses the turn
 *   - 'flag'   — soft block; the agent must surface the citation and
 *                wait for explicit operator approval
 *   - 'allow'  — explicit allow; included so a more-specific rule can
 *                override a generic one in the same jurisdiction
 */

export type RegulatoryVerdict = 'allow' | 'refuse' | 'flag';

/**
 * Regulated mining-estate actions the policy gate screens.
 *
 *   - pay_royalty            — settle the statutory mineral royalty
 *   - file_royalty_return    — lodge the periodic royalty return
 *   - export_mineral         — ship mineral / concentrate for export or offtake
 *   - sell_gold              — sell refined gold (Bank of Tanzania window)
 *   - transfer_licence       — assign / transfer a mining licence
 *   - operate_without_licence — conduct mining/processing on a tenement
 *   - suspend_licence        — suspend / revoke a licence holder's rights
 *   - use_mercury            — use mercury in ASM gold processing
 */
export type RegulatoryAction =
  | 'pay_royalty'
  | 'file_royalty_return'
  | 'export_mineral'
  | 'sell_gold'
  | 'transfer_licence'
  | 'operate_without_licence'
  | 'suspend_licence'
  | 'use_mercury';

export interface RegulatoryRulePayload {
  /** Transaction / consideration amount in currency minor units. */
  readonly amountMinor?: number;
  /** Gross sale or production value the royalty is assessed on, minor units. */
  readonly grossValueMinor?: number;
  readonly currencyCode?: string;
  /** Royalty rate actually applied, as a percentage (e.g. 6 for 6 %). */
  readonly royaltyRatePct?: number;
  /** Clearing-house inspection fee actually applied, as a percentage. */
  readonly clearingFeePct?: number;
  /** Days late relative to a statutory filing / payment deadline. */
  readonly daysLate?: number;
  /** Holder licence tier for the tenement in question. */
  readonly licenceTier?: 'PML' | 'PL' | 'ML' | 'SML';
  /** Whether the actor holds a valid, active licence for the action. */
  readonly hasValidLicence?: boolean;
  /** Whether the actor holds an approved EIA / environmental certificate. */
  readonly hasEnvironmentalApproval?: boolean;
  /** Whether the Mining Commission has consented (e.g. to a transfer). */
  readonly hasCommissionConsent?: boolean;
  /** Whether refined gold was routed through the Bank of Tanzania window. */
  readonly routedThroughGoldWindow?: boolean;
  /**
   * Free-form extra context — never required by the matchers; available
   * to bespoke jurisdiction-level rules that need access to atypical
   * fields without growing the typed shape.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface RegulatoryRule {
  readonly id: string;
  readonly jurisdiction: 'TZ' | 'KE' | 'UAE';
  readonly action: RegulatoryAction;
  /** Short statute reference shown back to the operator. */
  readonly citation: string;
  /** One-sentence human-readable rationale. */
  readonly rationale: string;
  readonly verdict: RegulatoryVerdict;
  /**
   * Pure function over the payload. Must NOT throw — defensive callers
   * still wrap in try/catch but rules are expected to be total.
   */
  readonly predicate: (payload: RegulatoryRulePayload) => boolean;
}

export interface RegulatoryRuleSet {
  readonly jurisdiction: 'TZ' | 'KE' | 'UAE';
  readonly displayName: string;
  readonly statuteVersion: string;
  readonly rules: ReadonlyArray<RegulatoryRule>;
}
