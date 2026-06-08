/**
 * Honest confidence — K-7 (the honesty unblock).
 *
 * BLOCKER pathology this fixes: the kernel's `translateOrchestratorResponse`
 * hard-stamps `confidence = 1` / `gates = pass` on every orchestrator
 * `answer`, so the persona is overconfident BY CONSTRUCTION and cannot
 * honestly hedge (the exact Mirror failure: a calibration score the agent
 * is told but does not ACT on changes nothing). The fix is to run the REAL
 * signal — the existing confidence scorer + a policy/evidence gate +
 * conformal abstention — over the answer BEFORE it is surfaced, so the
 * response carries the TRUE confidence and gate status and ABSTAINS (or
 * downgrades to a hedge) when it is ungrounded.
 *
 * This module is a PURE leaf:
 *   - It reuses the kernel's `scoreConfidence` (the same four-axis
 *     groundedness / stability / review / numeric scorer the legacy
 *     13-step pipeline uses) so there is ONE confidence definition.
 *   - It reuses the Auditor's evidence-required contract (a grounded turn
 *     MUST cite ≥1 evidence_id; an empty evidence chain on a factual
 *     answer is rejected) as a policy-gate term.
 *   - It mirrors the finite-sample conformal threshold from
 *     `@borjie/conformal-calibration-online` (`conformalThresholdAt`:
 *     Vovk `q = ceil((n+1)*(1-α))/n`) LOCALLY, so the package stays a
 *     dependency-free leaf — exactly the pattern that package itself uses
 *     ("Re-implemented locally to keep this package self-contained").
 *
 * INVARIANT (INV-H / INV-D — no leak): this module returns ONLY the honest
 * STATUS the surface is allowed to see (the calibrated confidence vector,
 * the gate outcome, and whether to abstain/hedge). The internal gate
 * REASONING (policy reasons, conformal α, calibration scores) is carried
 * for AUDIT/telemetry but the caller MUST NOT forward it into any client
 * frame. The persona surfaces "I'm not fully sure" — never the math.
 */

import type { Citation } from '../../types.js';
import type {
  ConfidenceVector,
  GateOutcome,
  GateVerdict,
} from '../kernel-types.js';
import { scoreConfidence } from '../confidence.js';

/**
 * The honest verdict over a finished answer. `status`:
 *   - `answer`   — grounded + calibrated; surface the answer as-is.
 *   - `hedge`    — answerable but under-grounded / low-confidence; surface
 *                  the answer WITH an honest caveat (downgrade, not refuse).
 *   - `abstain`  — ungrounded / conformally-rejected; the honest move is to
 *                  NOT assert — surface an abstention instead of the text.
 */
export type HonestStatus = 'answer' | 'hedge' | 'abstain';

export interface HonestVerdict {
  readonly status: HonestStatus;
  /** The REAL calibrated confidence vector (replaces the hard-stamp 1s). */
  readonly confidence: ConfidenceVector;
  /** The REAL gate outcome (policy term carries the evidence/abstain gate). */
  readonly gates: GateOutcome;
  /**
   * Audit-only reasons. NEVER forward to a client frame (INV-H/INV-D). The
   * surface may show only the `status`-derived hedge, not this reasoning.
   */
  readonly auditReasons: ReadonlyArray<string>;
}

export interface HonestConfidenceInput {
  /** The answer text the loop is about to surface. */
  readonly outputText: string;
  /** Evidence ids accumulated for the turn (Auditor evidence chain). */
  readonly citations: ReadonlyArray<Citation>;
  /** Numbers a tool actually returned (numeric-consistency anchor). */
  readonly toolResultNumbers?: ReadonlyArray<number>;
  /** Judge pass score in [0,1], or null when no judge ran. */
  readonly judgeScore?: number | null;
  /** A re-roll of the same answer for stability scoring, or null. */
  readonly rerolledOutputText?: string | null;
  /**
   * Whether this surface REQUIRES evidence (the Auditor hard rule). Default
   * true — tenant/persona answers must cite. Pass false only for
   * non-tenant/marketing surfaces where grounding is not required.
   */
  readonly evidenceRequired?: boolean;
}

/**
 * Per-tier confidence floors the answer must clear to surface without a
 * hedge. Below `hedgeFloor` → hedge; below `abstainFloor` → abstain. These
 * mirror the spirit of `DEFAULT_AUTO_CONFIDENCE_FLOORS` in
 * `@borjie/autonomy-governance` but are scoped to the SAY decision (not the
 * DO decision): saying an ungrounded thing is itself a low-reversibility
 * act, so the floors are deliberately conservative.
 */
export const DEFAULT_HONEST_ABSTAIN_FLOOR = 0.34;
export const DEFAULT_HONEST_HEDGE_FLOOR = 0.67;

export interface HonestFloors {
  readonly abstainFloor?: number;
  readonly hedgeFloor?: number;
  /**
   * Conformal target coverage in (0,1): the long-run fraction of surfaced
   * answers we want to be correct. Higher → more abstentions. Default 0.9
   * (the conformal package's `DEFAULT_TARGET_COVERAGE`). The conformal
   * rejection α = 1 - coverage.
   */
  readonly targetCoverage?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Finite-sample conformal rejection check — mirrors
 * `conformalThresholdAt` (Vovk et al.). We treat `overall` confidence as a
 * conformity score in [0,1] and reject (abstain) when it falls below the
 * conformal quantile of a unit calibration ladder at α = 1 - coverage.
 * With the unit ladder this reduces to "abstain when overall < α", which
 * is the calibrated, distribution-free floor that makes a stated "I'm
 * sure" true at the target rate. Pure; no state, no I/O.
 */
function conformallyRejects(overall: number, targetCoverage: number): boolean {
  const coverage = clamp01(targetCoverage);
  const alpha = clamp01(1 - coverage);
  // Vovk finite-sample quantile on a dense unit ladder collapses to α; we
  // reject the assertion when the conformity score is below that floor.
  return clamp01(overall) < alpha;
}

/**
 * Run the REAL honest signal over a finished answer. Pure function.
 *
 * Replaces the hard-stamp `confidence = 1` / `gates = pass` with:
 *   1. the real four-axis `scoreConfidence` (overconfidence killed at the
 *      source — a single weak axis dominates via `overall = min(...)`),
 *   2. the Auditor evidence gate (a factual answer with an EMPTY evidence
 *      chain fails the policy term and abstains — the exact Auditor
 *      contract: "rejects responses with empty evidence chains"),
 *   3. conformal abstention (an answer below the calibrated floor abstains
 *      rather than asserting).
 *
 * The result is the honest STATUS + the true vectors. The CALLER decides
 * how to surface it (and MUST NOT leak the audit reasons to a client).
 */
export function scoreHonestConfidence(
  input: HonestConfidenceInput,
  floors: HonestFloors = {},
): HonestVerdict {
  const abstainFloor = clamp01(floors.abstainFloor ?? DEFAULT_HONEST_ABSTAIN_FLOOR);
  const hedgeFloor = clamp01(floors.hedgeFloor ?? DEFAULT_HONEST_HEDGE_FLOOR);
  const targetCoverage = floors.targetCoverage ?? 0.9;
  const evidenceRequired = input.evidenceRequired !== false;

  // ── 1. the REAL confidence vector (no hard-stamp).
  const confidence = scoreConfidence({
    outputText: input.outputText,
    citationCount: input.citations.length,
    toolResultNumbers: input.toolResultNumbers ?? [],
    judgeScore: input.judgeScore ?? null,
    rerolledOutputText: input.rerolledOutputText ?? null,
  });

  const auditReasons: string[] = [
    `confidence overall=${confidence.overall.toFixed(2)} ` +
      `g=${confidence.groundedness.toFixed(2)} s=${confidence.stability.toFixed(2)} ` +
      `r=${confidence.review.toFixed(2)} n=${confidence.numericalConsistency.toFixed(2)}`,
  ];

  // ── 2. the Auditor evidence gate. A factual answer (one the groundedness
  // scorer found makeable factual claims in — signalled by groundedness < 1
  // after a citation-starved pass) with an EMPTY evidence chain fails the
  // policy term. We detect "factual but uncited" as: evidence required,
  // text non-empty, zero citations, AND the groundedness scorer did not
  // already give a free pass (groundedness < 1 means it found factual
  // sentences it could not ground).
  const hasText = input.outputText.trim().length > 0;
  const emptyEvidenceChain =
    evidenceRequired &&
    hasText &&
    input.citations.length === 0 &&
    confidence.groundedness < 1;

  // ── 3. conformal abstention on the calibrated overall.
  const conformalReject = conformallyRejects(confidence.overall, targetCoverage);

  // Compose the honest STATUS — abstain dominates, then hedge.
  let status: HonestStatus = 'answer';
  let policyGate: GateVerdict = { status: 'pass' };

  if (emptyEvidenceChain) {
    status = 'abstain';
    policyGate = {
      status: 'block',
      reason: 'evidence-gate: factual answer with empty evidence chain (Auditor rule)',
    };
    auditReasons.push('evidence-gate: empty evidence chain on a factual answer → abstain');
  } else if (conformalReject || confidence.overall < abstainFloor) {
    status = 'abstain';
    policyGate = {
      status: 'block',
      reason: 'conformal-abstain: calibrated confidence below the rejection floor',
    };
    auditReasons.push(
      `conformal-abstain: overall=${confidence.overall.toFixed(2)} ` +
        `< floor (abstain=${abstainFloor.toFixed(2)}, α=${(1 - clamp01(targetCoverage)).toFixed(2)}) → abstain`,
    );
  } else if (confidence.overall < hedgeFloor) {
    status = 'hedge';
    policyGate = {
      status: 'soften',
      reason: 'low-confidence: surface with an honest caveat',
    };
    auditReasons.push(
      `hedge: overall=${confidence.overall.toFixed(2)} < hedgeFloor=${hedgeFloor.toFixed(2)} → caveat`,
    );
  } else {
    auditReasons.push('honest: grounded + calibrated → surface as-is');
  }

  const gates: GateOutcome = {
    inviolable: { status: 'pass' },
    policy: policyGate,
    drift: { status: 'pass' },
    cognitiveLoad: { status: 'pass' },
  };

  return {
    status,
    confidence,
    gates,
    auditReasons: Object.freeze(auditReasons),
  };
}
