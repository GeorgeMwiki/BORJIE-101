/**
 * decideAutonomy — the continuous, per-decision autonomy controller.
 *
 * Pure function. No I/O, no clock, no mutation. Inputs in, verdict out.
 *
 * It computes how much human oversight a single proposed action needs by
 * fusing four axes plus live situation signals:
 *
 *   1. consequence × reversibility   — the 2-D blast-radius surface.
 *   2. calibrated confidence         — must clear a per-consequence-tier
 *                                      floor to be eligible for `auto`.
 *   3. delegation mandate            — a CEILING on the reachable
 *                                      autonomy for this task-class.
 *   4. situation flags               — live re-gating signals that can
 *                                      only ESCALATE.
 *
 * The function only ever computes a STANDALONE recommendation. It is the
 * caller's responsibility to compose it with the existing rails via
 * `composeWithRail` so the invariant "rail-gate ALWAYS wins" holds — see
 * `./compose-with-rail.ts`. Used alone, this never relaxes a rail because
 * it never sees one; used composed, it can only escalate.
 *
 * Reference: ORCHESTRATION_FRONTIER_ADDENDUM.md §"Confidence × consequence
 * × reversibility-adaptive delegation gated on conformal calibration".
 */

import type {
  AutonomyDecision,
  ConsequenceTier,
  DecideAutonomyInput,
  DecideAutonomyOutput,
  DelegationMandate,
  Reversibility,
  SituationFlags,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Escalation ordering helpers — `auto` < `gate` < `four_eyes`.
// ─────────────────────────────────────────────────────────────────────

const DECISION_RANK: Readonly<Record<AutonomyDecision, number>> = Object.freeze({
  auto: 0,
  gate: 1,
  four_eyes: 2,
});

/** Return whichever decision is the MORE-cautious (higher rank). */
export function moreCautious(
  a: AutonomyDecision,
  b: AutonomyDecision,
): AutonomyDecision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/** TRUE when `candidate` is at least as cautious as `floor`. */
export function isAtLeastAsCautious(
  candidate: AutonomyDecision,
  floor: AutonomyDecision,
): boolean {
  return DECISION_RANK[candidate] >= DECISION_RANK[floor];
}

// ─────────────────────────────────────────────────────────────────────
// Per-consequence-tier calibrated-confidence floors required to `auto`.
// Higher consequence demands higher calibrated confidence. `severe` is
// pinned at +Infinity so confidence can NEVER unlock auto on the
// money/licence/deletion class — those stay dual-control HITL forever.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_AUTO_CONFIDENCE_FLOORS: Readonly<
  Record<ConsequenceTier, number>
> = Object.freeze({
  trivial: 0.5,
  low: 0.7,
  moderate: 0.85,
  high: 0.95,
  severe: Number.POSITIVE_INFINITY,
});

// ─────────────────────────────────────────────────────────────────────
// The consequence × reversibility surface → the minimum decision this
// surface alone forces (its "consequence floor"). This is the 2-D table
// the flat 5-tier ladder cannot express: the reversible body of a flow
// runs free; only the irreversible / high-consequence corner gates.
//
//   rows  = consequence tier
//   cols  = reversibility
// ─────────────────────────────────────────────────────────────────────

const CONSEQUENCE_SURFACE: Readonly<
  Record<ConsequenceTier, Readonly<Record<Reversibility, AutonomyDecision>>>
> = Object.freeze({
  trivial: Object.freeze({
    reversible: 'auto',
    staged: 'auto',
    costly: 'auto',
    irreversible: 'auto',
  }),
  low: Object.freeze({
    reversible: 'auto',
    staged: 'auto',
    costly: 'auto',
    irreversible: 'gate',
  }),
  moderate: Object.freeze({
    reversible: 'auto',
    staged: 'auto',
    costly: 'gate',
    irreversible: 'gate',
  }),
  high: Object.freeze({
    reversible: 'auto',
    staged: 'gate',
    costly: 'gate',
    irreversible: 'four_eyes',
  }),
  // `severe` = money / licence / deletion. Dual-control HITL forever,
  // regardless of reversibility — Write-Staging makes that ergonomic but
  // never crosses the line (frontier addendum "Rejected" §2).
  severe: Object.freeze({
    reversible: 'four_eyes',
    staged: 'four_eyes',
    costly: 'four_eyes',
    irreversible: 'four_eyes',
  }),
});

// ─────────────────────────────────────────────────────────────────────
// The mandate CEILING — the most autonomy a task-class posture permits.
// A ceiling caps the reachable autonomy; it can only make a decision MORE
// cautious, never less. (E.g. `observer` forces everything to gate.)
// ─────────────────────────────────────────────────────────────────────

const MANDATE_CEILING: Readonly<Record<DelegationMandate, AutonomyDecision>> =
  Object.freeze({
    observer: 'four_eyes',
    approver: 'gate',
    consultant: 'gate',
    collaborator: 'auto',
    operator: 'auto',
  });

// ─────────────────────────────────────────────────────────────────────
// Situation flags — each present flag escalates to AT LEAST the listed
// decision. Defection / sovereign-drift / exhausted-irreversibility-budget
// are dual-control escalations; the rest are single-gate escalations.
// ─────────────────────────────────────────────────────────────────────

interface SituationRule {
  readonly key: keyof SituationFlags;
  readonly escalateTo: AutonomyDecision;
  readonly reason: string;
}

const SITUATION_RULES: ReadonlyArray<SituationRule> = Object.freeze([
  {
    key: 'defectionProbeHit',
    escalateTo: 'four_eyes',
    reason: 'situation: inline defection/alignment-faking probe hit',
  },
  {
    key: 'driftTowardSovereign',
    escalateTo: 'four_eyes',
    reason: 'situation: reasoning drifted toward a sovereign/kill_switch prefix',
  },
  {
    key: 'irreversibilityBudgetExhausted',
    escalateTo: 'four_eyes',
    reason: 'situation: cumulative irreversibility budget exhausted',
  },
  {
    key: 'anomalyDetected',
    escalateTo: 'gate',
    reason: 'situation: anomaly-detector flagged this trace',
  },
  {
    key: 'novelCounterparty',
    escalateTo: 'gate',
    reason: 'situation: novel counterparty (no prior transaction history)',
  },
  {
    key: 'regimeShift',
    escalateTo: 'gate',
    reason: 'situation: FX/market regime shift detected',
  },
  {
    key: 'capSlowdown',
    escalateTo: 'gate',
    reason: 'situation: autonomy cap in slowdown band',
  },
  {
    key: 'counterfactualConcern',
    escalateTo: 'gate',
    reason: 'situation: counterfactual self-check surfaced a material downside',
  },
  {
    key: 'offHours',
    escalateTo: 'gate',
    reason: 'situation: action proposed outside Tanzania business hours',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Clamp to [0,1]; non-finite → 0 (fail-cautious). */
function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function resolveConfidenceFloor(
  tier: ConsequenceTier,
  overrides: Partial<Record<ConsequenceTier, number>> | undefined,
): number {
  const base = DEFAULT_AUTO_CONFIDENCE_FLOORS[tier];
  const override = overrides?.[tier];
  if (typeof override !== 'number' || !Number.isFinite(override)) return base;
  return clampUnit(override);
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the standalone continuous autonomy recommendation.
 *
 * The result is the MOST cautious of four independent contributions:
 *   - the consequence × reversibility surface,
 *   - the confidence-floor gate (insufficient calibrated confidence),
 *   - the mandate ceiling,
 *   - the fused situation-flag escalations.
 *
 * `gatedBy` records which contribution produced the final (most-severe)
 * decision; on a tie the order of severity-attribution is
 * consequence → confidence → mandate → situation, chosen so the most
 * structural cause is surfaced first.
 */
export function decideAutonomy(
  input: DecideAutonomyInput,
): DecideAutonomyOutput {
  const reasons: string[] = [];
  const confidence = clampUnit(input.calibratedConfidence);

  // ── 1. Consequence × reversibility surface ──
  const consequenceDecision =
    CONSEQUENCE_SURFACE[input.consequenceTier][input.reversibility];
  reasons.push(
    `consequence: tier='${input.consequenceTier}' reversibility='${input.reversibility}' → ${consequenceDecision}`,
  );

  // ── 2. Calibrated-confidence floor. Below the floor → gate. ──
  const floor = resolveConfidenceFloor(
    input.consequenceTier,
    input.autoConfidenceFloors,
  );
  const confidenceDecision: AutonomyDecision =
    confidence >= floor ? 'auto' : 'gate';
  if (confidenceDecision === 'auto') {
    reasons.push(
      `confidence: calibrated ${confidence.toFixed(3)} >= floor ${formatFloor(floor)} → auto-eligible`,
    );
  } else {
    reasons.push(
      `confidence: calibrated ${confidence.toFixed(3)} < floor ${formatFloor(floor)} → gate`,
    );
  }

  // ── 3. Mandate ceiling. ──
  const mandateCeiling = MANDATE_CEILING[input.mandate];
  reasons.push(`mandate: '${input.mandate}' ceiling → ${mandateCeiling}`);

  // ── 4. Situation flags — fuse every fired rule. ──
  let situationDecision: AutonomyDecision = 'auto';
  const flags = input.situationFlags;
  if (flags) {
    for (const rule of SITUATION_RULES) {
      if (flags[rule.key] === true) {
        situationDecision = moreCautious(situationDecision, rule.escalateTo);
        reasons.push(`${rule.reason} → at least ${rule.escalateTo}`);
      }
    }
  }

  // ── Combine: the MOST cautious of all four contributions. ──
  const decision = [
    consequenceDecision,
    confidenceDecision,
    mandateCeiling,
    situationDecision,
  ].reduce(moreCautious, 'auto');

  const gatedBy = attributeGatedBy(decision, {
    consequenceDecision,
    confidenceDecision,
    mandateCeiling,
    situationDecision,
  });

  reasons.push(`decision: ${decision} (gatedBy=${gatedBy ?? 'none'})`);

  return Object.freeze({
    decision,
    reasons: Object.freeze(reasons),
    gatedBy,
  });
}

function formatFloor(floor: number): string {
  return Number.isFinite(floor) ? floor.toFixed(3) : '∞ (auto-ineligible)';
}

interface Contributions {
  readonly consequenceDecision: AutonomyDecision;
  readonly confidenceDecision: AutonomyDecision;
  readonly mandateCeiling: AutonomyDecision;
  readonly situationDecision: AutonomyDecision;
}

/**
 * Attribute the final decision to the first contribution (in severity-
 * attribution order) that reached it. Returns `null` only when the final
 * decision is `auto` (nothing escalated).
 */
function attributeGatedBy(
  decision: AutonomyDecision,
  c: Contributions,
): DecideAutonomyOutput['gatedBy'] {
  if (decision === 'auto') return null;
  if (c.consequenceDecision === decision) return 'consequence';
  if (c.confidenceDecision === decision) return 'confidence';
  if (c.mandateCeiling === decision) return 'mandate';
  if (c.situationDecision === decision) return 'situation';
  // Unreachable — `decision` is the max of the four, so at least one
  // contribution equals it. Default to consequence for total safety.
  return 'consequence';
}
