/**
 * Shadow-mode-then-convert cutover gate — public types.
 *
 * Brightlume's framework (March 2026), reproduced verbatim from
 * `.audit/litfin-sota-2026-05-23/10-outcome-as-a-service.md` §2.3:
 *
 *   Phase 1 (Wk 1-2):  isolated execution env, input mirroring, decision log
 *   Phase 2 (Wk 3-8):  shadow on high-volume/low-risk first, weekly calibration
 *   Phase 3 (Wk 9-12): graduated responsibility, stratified review, rollback triggers
 *
 *   Conversion gates (ALL must pass):
 *     - >= 85% agreement rate
 *     - 0 critical policy violations in last 500 decisions
 *     - confidence correlation >= 0.7
 *     - minimum 5,000-10,000 decisions processed
 *     - stakeholder sign-off (business, compliance, ops)
 *
 *   Result: orgs that run proper shadow modes have 85%+ success rate on
 *   production cutover. Most pilots fail because they skip this — 85% of
 *   enterprises pilot, only 5% reach production.
 *
 * This substrate is wire-agnostic. The migration + shadow-runner that
 * persists decisions and computes agreement on the fly is a downstream
 * concern (next round). This file defines the pure data contracts; the
 * scorers + cutover-gate consume them as immutable inputs.
 *
 * Sequoia-tracked: 85% cutover success when shadow-mode-then-convert is
 * applied vs 5% direct pilot.
 */

/**
 * Kind of decision being scored. The scorer dispatches on this:
 *   - `binary`     exact-match equivalence (approve/deny, yes/no)
 *   - `numeric`    threshold-bounded equivalence (within tolerance)
 *
 * The threshold-bounded path is needed because numeric decisions
 * (rent estimate, refund amount, late-fee cents) are almost never
 * byte-identical between AI and human — agreement is "within X".
 */
export type DecisionKind = 'binary' | 'numeric';

/**
 * A single shadow-mode decision pair. The AI ran in parallel with the
 * human (or with the pre-AI baseline); both verdicts and the AI's
 * self-reported confidence are captured for scoring.
 *
 * Invariants (enforced by the scorers, not by the type system):
 *   - `confidence` is in [0, 1] (NaN / out-of-range is treated as a
 *     calibration failure for that single decision and excluded from
 *     the correlation, but still counted toward agreement).
 *   - For `kind:'binary'`, `aiVerdict` and `humanVerdict` are compared
 *     by strict equality (`===`).
 *   - For `kind:'numeric'`, agreement is `|ai - human| <= tolerance`.
 *     The tolerance is supplied at scorer-call time, not stored per
 *     decision — different metrics (cents vs percent) use different
 *     tolerances and we want one knob, not N.
 *   - `isCriticalViolation` is the constitution-violation flag: a single
 *     `true` blocks cutover regardless of agreement rate. This is the
 *     Klarna fingerprint defense — high aggregate agreement does not
 *     compensate for a constitution breach.
 */
export interface ShadowDecision {
  readonly id: string;
  readonly subMd: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly kind: DecisionKind;
  readonly aiVerdict: string | number | boolean;
  readonly humanVerdict: string | number | boolean;
  readonly confidence: number;
  readonly isCriticalViolation: boolean;
}

/**
 * A shadow-mode session — a fixed corpus of decisions evaluated against
 * one set of cutover criteria. Sessions are immutable snapshots; the
 * runner that builds them is downstream.
 */
export interface ShadowSession {
  readonly id: string;
  readonly subMd: string;
  readonly tenantId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly decisions: ReadonlyArray<ShadowDecision>;
}

/**
 * The four cutover criteria. ALL must pass for cutover to be approved.
 *
 * Defaults match the spec headline (`DEFAULT_CUTOVER_CRITERIA`):
 *   - minAgreementRate:           0.85    (>= 85% AI vs human)
 *   - minSampleSize:              5000    (Brightlume floor)
 *   - maxCriticalViolations:      0       (zero tolerance)
 *   - minConfidenceCorrelation:   0.7     (Pearson)
 *
 * `numericTolerance` is the per-evaluation knob for threshold-bounded
 * equivalence on `kind:'numeric'` decisions. Supplied at criteria-level
 * (not per-decision) so one cutover run uses one tolerance — the gate
 * is reproducible from (session, criteria) alone.
 */
export interface CutoverCriteria {
  readonly minAgreementRate: number;
  readonly minSampleSize: number;
  readonly maxCriticalViolations: number;
  readonly minConfidenceCorrelation: number;
  readonly numericTolerance: number;
}

/**
 * Per-criterion verdict surfaced inside `CutoverResult`. Each criterion
 * carries both its pass/fail flag and the observed value, so callers can
 * render an audit trail without re-running the scorers.
 */
export interface CutoverCriterionResult {
  readonly passed: boolean;
  readonly observed: number;
  readonly threshold: number;
  readonly reason: string;
}

/**
 * The cutover gate's verdict. Pure function of (session, criteria) so the
 * decision is reproducible from the log.
 *
 * `approved` is the AND of all four criterion `passed` flags. A failed
 * criterion does NOT short-circuit evaluation — we always report the full
 * grid because operators need to see how far from cutover they are on
 * every axis (e.g. "agreement is fine, sample is fine, correlation is
 * 0.62 not 0.70" is qualitatively different from "everything failed").
 */
export interface CutoverResult {
  readonly approved: boolean;
  readonly agreement: CutoverCriterionResult;
  readonly sampleSize: CutoverCriterionResult;
  readonly criticalViolations: CutoverCriterionResult;
  readonly confidenceCorrelation: CutoverCriterionResult;
  readonly summary: string;
}

/**
 * Spec-headline cutover criteria. Frozen — never mutate at runtime.
 */
export const DEFAULT_CUTOVER_CRITERIA: Readonly<CutoverCriteria> = Object.freeze({
  minAgreementRate: 0.85,
  minSampleSize: 5000,
  maxCriticalViolations: 0,
  minConfidenceCorrelation: 0.7,
  numericTolerance: 0.05,
});
