/**
 * composeWithRail — the load-bearing composition primitive.
 *
 * The continuous autonomy controller (`decideAutonomy`) is ADDITIVE. It
 * runs AFTER/ALONGSIDE the existing inviolable rails (policy-gate,
 * inviolable, HIGH-risk-literal prefixes, four-eye, kill-switch). Its one
 * and only contract with those rails is:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  RAIL-GATE ALWAYS WINS. The controller may only ESCALATE.     │
 *   │  - rail GATES  →  result is gated, regardless of the          │
 *   │                   controller's computation.                  │
 *   │  - rail ALLOWS →  the controller may turn it INTO a gate      │
 *   │                   (more cautious) but can NEVER turn a        │
 *   │                   rail-gated action into `auto`.              │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * This is a pure function with no knowledge of HOW the rail decided. The
 * caller collapses the existing rail stack into a single
 * `RailOutcome` ('allow' | 'gate' | 'four_eyes') and passes it alongside
 * the controller's standalone recommendation. The two are combined by
 * taking the MOST-cautious of the two — which is exactly "rail-gate
 * always wins, controller may only add gating".
 *
 * Because the combine is monotone (max over the escalation order), the
 * invariant holds by construction: there is no input under which a
 * rail-gated outcome can be downgraded to `auto`.
 */

import { moreCautious } from './decide-autonomy.js';
import type { AutonomyDecision, DecideAutonomyOutput } from './types.js';

/**
 * Collapsed verdict of the existing rail stack for one action.
 *
 *   - `allow`     — every rail passed (policy-gate pass/soften,
 *                   inviolable pass, no HIGH-risk-literal prefix, no
 *                   four-eye/kill-switch trigger). The controller is free
 *                   to add gating on top.
 *   - `gate`      — a rail demands single human confirmation.
 *   - `four_eyes` — a rail demands dual-control (sovereign / money /
 *                   licence / deletion / four-eye / kill-switch).
 */
export type RailOutcome = 'allow' | 'gate' | 'four_eyes';

/** Map a rail outcome onto the autonomy-decision lattice. */
function railToDecision(rail: RailOutcome): AutonomyDecision {
  return rail === 'allow' ? 'auto' : rail;
}

export interface ComposedAutonomyOutput extends DecideAutonomyOutput {
  /** The rail outcome that was composed in. */
  readonly railOutcome: RailOutcome;
  /**
   * TRUE when the rail (not the controller) set the final, most-severe
   * decision — i.e. the rail's mapped decision is at least as cautious
   * as the controller's standalone recommendation.
   */
  readonly railDominated: boolean;
}

/**
 * Compose the rail outcome with the controller's standalone
 * recommendation. The result is the more-cautious of the two; it is
 * NEVER less cautious than the rail.
 *
 * @param rail        collapsed verdict of the existing rail stack.
 * @param controller  the standalone output of `decideAutonomy`.
 */
export function composeWithRail(
  rail: RailOutcome,
  controller: DecideAutonomyOutput,
): ComposedAutonomyOutput {
  const railDecision = railToDecision(rail);
  const decision = moreCautious(railDecision, controller.decision);

  const railDominated = decision === railDecision && rail !== 'allow';

  const reasons: string[] = [
    `rail: outcome='${rail}' → ${railDecision}`,
    ...controller.reasons,
  ];

  if (rail !== 'allow') {
    reasons.push(
      `composition: rail-gate is binding — final cannot be weaker than '${railDecision}'`,
    );
  }
  if (decision !== controller.decision) {
    reasons.push(
      `composition: escalated from controller '${controller.decision}' to '${decision}' by rail`,
    );
  } else if (rail !== 'allow' && railDecision !== controller.decision) {
    reasons.push(
      `composition: controller '${controller.decision}' already more cautious than rail '${railDecision}'`,
    );
  }

  // `gatedBy`: if the rail set (or tied for) the final decision, the rail
  // is the cause; otherwise keep the controller's attribution.
  const gatedBy =
    decision === 'auto'
      ? null
      : railDominated
        ? ('consequence' as const)
        : controller.gatedBy;

  return Object.freeze({
    decision,
    reasons: Object.freeze(reasons),
    gatedBy,
    railOutcome: rail,
    railDominated,
  });
}
