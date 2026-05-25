/**
 * Regulatory rule types — shared shape across all jurisdictions.
 *
 * A rule is the unit of "this action is constrained by this statute" —
 * the kernel's regulatory-mirror module evaluates `predicate(payload)`
 * and, when it returns `true`, returns the rule's `verdict` plus the
 * `citation` so the agent's output can quote the source-of-truth.
 *
 * Verdicts:
 *   - 'refuse' — hard block; the policy gate refuses the turn
 *   - 'flag'   — soft block; the agent must surface the citation and
 *                wait for explicit operator approval
 *   - 'allow'  — explicit allow; included so a more-specific rule can
 *                override a generic one in the same jurisdiction
 */

export type RegulatoryVerdict = 'allow' | 'refuse' | 'flag';

export type RegulatoryAction =
  | 'collect_deposit'
  | 'issue_eviction_notice'
  | 'raise_rent'
  | 'distrain_goods'
  | 'enter_premises'
  | 'evict'
  | 'recover_arrears';

export interface RegulatoryRulePayload {
  readonly amountMinor?: number;
  readonly monthlyRentMinor?: number;
  readonly currencyCode?: string;
  readonly noticeDays?: number;
  readonly increasePercentage?: number;
  readonly tenantHasArrears?: boolean;
  readonly hasCourtOrder?: boolean;
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
