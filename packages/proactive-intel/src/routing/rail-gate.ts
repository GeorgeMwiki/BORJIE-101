/**
 * Rail-gate composition — the constitutional guard.
 *
 * This layer is ADDITIVE and COMPOSES WITH the kernel rails. It NEVER
 * imports, modifies, weakens, or bypasses `policy-gate.ts` /
 * `inviolable.ts` / the money path. Instead the host evaluates those
 * rails (it owns them) and passes the verdict in via the
 * `RailGateVerdict` port.
 *
 * THE INVARIANT (a violation fails the lane):
 *   - If a rail says GATE, the action is gated REGARDLESS of any
 *     autonomy computation in this package. Rail-gate ALWAYS wins.
 *   - This controller may only ADD gating, NEVER remove it.
 *
 * So `applyRailGate` is monotone: given a candidate decision, it can
 * flip `requiresHumanApproval` false→true and `autonomyEligible`
 * true→false, but never the reverse.
 */
import type {
  DataRoutingDecision,
  RoutingEvidence,
  RoutingRationale,
} from './routing-types.js';

/**
 * The host's verdict from the REAL kernel rails. The host computes this
 * by calling the actual policy-gate / inviolable / four-eye / money-path
 * checks — this package only consumes the result.
 *
 * `decision`:
 *   - 'GATE'  → a rail demands a human. Always wins.
 *   - 'PASS'  → no rail objection; autonomy computation may proceed.
 */
export interface RailGateVerdict {
  readonly decision: 'GATE' | 'PASS';
  /**
   * The rail prefix that gated, if any — one of the HIGH-risk policy
   * prefixes (sovereign / kill_switch / four_eye / policy_rollout) or a
   * money/licence/deletion marker. Surfaced as evidence; never used to
   * weaken anything.
   */
  readonly railPrefix?:
    | 'sovereign'
    | 'kill_switch'
    | 'four_eye'
    | 'policy_rollout'
    | 'money'
    | 'licence'
    | 'deletion'
    | (string & {});
  /** Human-readable reason from the rail (audit). */
  readonly reason?: string;
}

/**
 * A PASS verdict constant — convenience for hosts that have already
 * cleared rails out-of-band, or for pure unit tests of the autonomy
 * computation in isolation.
 */
export const RAIL_PASS: RailGateVerdict = { decision: 'PASS' } as const;

/**
 * Apply the rail verdict to a candidate decision. MONOTONE — only ever
 * tightens. When the rail gates, force `requiresHumanApproval = true`,
 * `autonomyEligible = false`, and append the rail evidence + rationale.
 *
 * When the rail passes, the candidate is returned unchanged (its own
 * confidence/missing-field gating still stands — this never loosens it).
 */
export function applyRailGate(
  candidate: DataRoutingDecision,
  verdict: RailGateVerdict,
): DataRoutingDecision {
  if (verdict.decision === 'PASS') {
    // Rails do not object. Do NOT loosen the candidate's own gating.
    return candidate;
  }

  // Rail GATE — always wins. Tighten, never loosen.
  const railEvidence: RoutingEvidence = {
    kind: 'rule',
    id: `rail:${verdict.railPrefix ?? 'gate'}`,
    ...(verdict.reason ? { detail: verdict.reason } : {}),
  };

  const rationale: RoutingRationale = {
    ...candidate.rationale,
    code: 'rail_gated',
    summary: verdict.reason
      ? `Gated by ${verdict.railPrefix ?? 'policy rail'}: ${verdict.reason}`
      : `Gated by ${verdict.railPrefix ?? 'policy rail'}.`,
    // Evidence is append-only — preserve the candidate's chain, add the rail.
    evidence: [...candidate.rationale.evidence, railEvidence],
  };

  return {
    ...candidate,
    rationale,
    requiresHumanApproval: true,
    autonomyEligible: false,
  };
}

/**
 * Convenience guard: is this decision safe to act on without a human?
 * True ONLY when not gated AND autonomy-eligible. The proactive worker
 * uses this as the final check before any auto-handling — a belt-and-
 * suspenders over `applyRailGate`.
 */
export function isAutoActionable(decision: DataRoutingDecision): boolean {
  return decision.autonomyEligible && !decision.requiresHumanApproval;
}
