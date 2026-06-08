/**
 * @borjie/autonomy-governance/decision — public types.
 *
 * Continuous autonomy-decision layer (ORCHESTRATION_FRONTIER_ADDENDUM
 * §"Confidence×consequence×reversibility-adaptive delegation gated on
 * conformal calibration"). This is the frontier replacement for the
 * 1-bit gated/auto switch: a per-DECISION continuous control whose
 * inputs are
 *
 *   - calibratedConfidence  (0..1) — MUST already be conformally
 *                            calibrated; "90% sure" is statistically
 *                            true 90% of the time. Calibration precedes
 *                            gating (LLM confidence is systematically
 *                            overconfident). Derive it from the
 *                            `@borjie/conformal-calibration-online`
 *                            state via `calibratedConfidenceFromConformal`.
 *   - consequenceTier        — how much blast-radius the action carries.
 *   - reversibility          — can the act be undone, and how cheaply.
 *   - mandate                — the standing delegation posture for the
 *                            task-class (earned/granted ceiling).
 *   - situationFlags         — live re-gating signals (novel
 *                            counterparty, FX-regime shift, drift toward
 *                            a sovereign/kill_switch prefix, anomaly,
 *                            defection-probe hit, off-hours, …).
 *
 * The output is one of three escalating decisions: `auto`, `gate`
 * (single-approver / owner confirm) or `four_eyes` (dual-control).
 *
 * ════════════════════════════════════════════════════════════════════
 * COMPOSITION INVARIANT (non-negotiable):
 * ════════════════════════════════════════════════════════════════════
 * This layer is ADDITIVE. It runs AFTER/ALONGSIDE the existing rails
 * (policy-gate / inviolable / HIGH-risk-literal prefixes /
 * four-eye / kill-switch). It may only ESCALATE. If a rail GATES, the
 * action is gated regardless of any computation here — rail-gate ALWAYS
 * wins. The controller may turn a rail-ALLOWED action INTO a gate (more
 * cautious); it may NEVER turn a rail-GATED action into `auto`. See
 * `composeWithRail` in `./compose-with-rail.ts`.
 */

/**
 * The continuous decision. Ordered by escalation severity:
 *   auto  <  gate  <  four_eyes
 *
 * - `auto`      — runs inside the proven, calibrated, bounded box; no
 *                 human in the per-action loop.
 * - `gate`      — single human confirmation / owner approval required.
 * - `four_eyes` — dual-control (two distinct authorised approvers).
 */
export type AutonomyDecision = 'auto' | 'gate' | 'four_eyes';

/**
 * Consequence tier — the blast-radius axis (distinct from
 * reversibility). A 2-D surface beats the flat 5-tier ladder: a cheap,
 * reversible action may run free even at a moderate consequence tier,
 * while a high-consequence irreversible action gates even with high
 * confidence.
 *
 *   - `trivial`  — read / view / draft; no external effect.
 *   - `low`      — small, scoped mutation; easily contained.
 *   - `moderate` — meaningful mutation; multi-record or notify side.
 *   - `high`     — large blast-radius mutation (bulk update, external
 *                  comms, billing-adjacent).
 *   - `severe`   — money movement / licence status / deletion class.
 *                  These map to the HIGH-risk literal-only surface and
 *                  are dual-control HITL forever; this layer can only
 *                  reinforce that, never relax it.
 */
export type ConsequenceTier =
  | 'trivial'
  | 'low'
  | 'moderate'
  | 'high'
  | 'severe';

/**
 * Reversibility — can the act be undone, and at what cost. Write-staging
 * converts an otherwise-irreversible post into a `staged` draft the
 * owner promotes; that reclassification is the caller's job — this layer
 * simply reads the resulting reversibility.
 *
 *   - `reversible`   — trivially undone (snooze, re-order, draft edit).
 *   - `staged`       — produced as a pending/draft that requires a
 *                      separate promotion step (Write-Staging); the
 *                      effect is reversible until promoted.
 *   - `costly`       — undoable but with real cost / latency / friction.
 *   - `irreversible` — cannot be undone once executed.
 */
export type Reversibility =
  | 'reversible'
  | 'staged'
  | 'costly'
  | 'irreversible';

/**
 * Standing delegation posture for the task-class (the earned/granted
 * ceiling). Mirrors the L1→L5 trust ladder. The mandate is a CEILING:
 * it can cap the maximum autonomy this decision is permitted to reach,
 * never a floor that forces autonomy.
 *
 *   - `observer`     — L5: the brain may only observe; everything gates.
 *   - `approver`     — L4: the brain proposes; humans approve. Effective
 *                      ceiling is `gate` (or `four_eyes` when escalated).
 *   - `consultant`   — L3: the brain advises; low-consequence reversible
 *                      acts may auto, everything else gates.
 *   - `collaborator` — L2: broad auto for reversible/low-consequence;
 *                      gate the irreversible/high-consequence tail.
 *   - `operator`     — L1: fullest earned autonomy; auto wherever the
 *                      calibrated risk surface permits.
 */
export type DelegationMandate =
  | 'observer'
  | 'approver'
  | 'consultant'
  | 'collaborator'
  | 'operator';

/**
 * Live re-gating signals fused into the decision. Each present flag can
 * only ESCALATE (push toward gate / four_eyes); none can relax. Entropy
 * alone is insufficient — multiple signals are fused (frontier addendum
 * §"earned/graduated trust … dynamic re-gating").
 */
export interface SituationFlags {
  /** A counterparty the estate has not transacted with before. */
  readonly novelCounterparty?: boolean;
  /** FX moved past the 27-Mar USD-cliff regime / a regime change fired. */
  readonly regimeShift?: boolean;
  /** Reasoning drifted toward a sovereign / kill_switch prefix. */
  readonly driftTowardSovereign?: boolean;
  /** Anomaly-detector flagged this trace. */
  readonly anomalyDetected?: boolean;
  /** Inline defection / alignment-faking probe hit on this action. */
  readonly defectionProbeHit?: boolean;
  /** Action proposed outside Tanzania business hours. */
  readonly offHours?: boolean;
  /** The autonomy cap is in slowdown (>= slowdownAt, < hardStopAt). */
  readonly capSlowdown?: boolean;
  /** The cumulative irreversibility budget for the window is exhausted. */
  readonly irreversibilityBudgetExhausted?: boolean;
  /** A counterfactual self-check ("what if my evidence_id is wrong?")
   *  surfaced a material downside. */
  readonly counterfactualConcern?: boolean;
}

/**
 * Inputs to the continuous autonomy decision.
 */
export interface DecideAutonomyInput {
  /**
   * Conformally-calibrated confidence in (0..1). MUST already be
   * calibrated — see `calibratedConfidenceFromConformal`. Values
   * outside [0,1] are clamped; a missing/NaN value is treated as 0
   * (fail-cautious).
   */
  readonly calibratedConfidence: number;
  readonly consequenceTier: ConsequenceTier;
  readonly reversibility: Reversibility;
  readonly mandate: DelegationMandate;
  /** Live re-gating signals. Absent = no signal fired. */
  readonly situationFlags?: SituationFlags;
  /**
   * Optional override of the per-tier confidence floors required to
   * auto. Operator-tunable; values are clamped to [0,1]. Omitted tiers
   * fall back to `DEFAULT_AUTO_CONFIDENCE_FLOORS`.
   */
  readonly autoConfidenceFloors?: Partial<Record<ConsequenceTier, number>>;
}

/**
 * The continuous autonomy verdict.
 */
export interface DecideAutonomyOutput {
  /** The escalating decision. */
  readonly decision: AutonomyDecision;
  /** Ordered, audit-grade reasons that drove the decision. Never empty. */
  readonly reasons: ReadonlyArray<string>;
  /**
   * What forced the most-severe escalation, for telemetry / audit.
   *   - `null`          — landed at `auto`; nothing escalated it.
   *   - `consequence`   — the consequence×reversibility surface.
   *   - `confidence`    — calibrated confidence below the tier floor.
   *   - `mandate`       — the delegation ceiling capped it.
   *   - `situation`     — a live re-gating signal fired.
   */
  readonly gatedBy:
    | null
    | 'consequence'
    | 'confidence'
    | 'mandate'
    | 'situation';
}
