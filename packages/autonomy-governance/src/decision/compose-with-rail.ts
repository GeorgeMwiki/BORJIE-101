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

/**
 * Collapsed verdict of the META-RAIL (`checkBodyChangeInviolable` in
 * `@borjie/central-intelligence/kernel/inviolable`) for a body-change.
 * This is the deterministic, no-LLM, fail-closed self-modification gate.
 *
 *   - `allow`  — the meta-rail found no prohibited self-change.
 *   - `forbid` — the change edits a rail / shortens the audit chain /
 *                raises an autonomy ceiling / fails integrity. A
 *                `forbid` forces the MOST-cautious decision (`four_eyes`)
 *                and can NEVER be downgraded.
 *
 * The meta-rail lives in `central-intelligence` (the kernel). To avoid a
 * dependency edge / cycle, this package never imports it directly — the
 * caller (the body-change syscall) computes the meta-rail verdict and
 * passes the collapsed outcome here as ONE MORE monotone input. Because
 * the combine is `moreCautious` (a max over the escalation order), adding
 * this term cannot weaken the existing "rail-gate always wins" proof:
 * the result is still the max of all inputs, so a `forbid` can only
 * ESCALATE, never relax.
 */
export type MetaRailOutcome = 'allow' | 'forbid';

/** Map a rail outcome onto the autonomy-decision lattice. */
function railToDecision(rail: RailOutcome): AutonomyDecision {
  return rail === 'allow' ? 'auto' : rail;
}

/**
 * Map the meta-rail outcome onto the autonomy-decision lattice. A
 * `forbid` is pinned to the MOST-cautious decision (`four_eyes`); an
 * `allow` contributes nothing (`auto`) so it never relaxes the rail.
 */
function metaRailToDecision(meta: MetaRailOutcome): AutonomyDecision {
  return meta === 'forbid' ? 'four_eyes' : 'auto';
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
  /**
   * The meta-rail outcome that was composed in. `'allow'` when no
   * meta-rail term was supplied (the default — preserves backward
   * compatibility for non-body-change calls).
   */
  readonly metaRailOutcome: MetaRailOutcome;
  /**
   * TRUE when the meta-rail FORBADE the body-change and thereby set (or
   * tied for) the final, most-severe decision. When TRUE the decision is
   * always `four_eyes` and can never be downgraded.
   */
  readonly metaRailForbade: boolean;
}

/**
 * Compose the rail outcome (and, optionally, the meta-rail outcome) with
 * the controller's standalone recommendation. The result is the
 * MOST-cautious of all supplied inputs; it is NEVER less cautious than
 * either the rail or the meta-rail.
 *
 * Monotonicity proof (unchanged + extended): the final decision is
 * `moreCautious(railDecision, controllerDecision, metaRailDecision)` —
 * a max over the escalation order `auto < gate < four_eyes`. Adding the
 * meta-rail term as one more argument to that max cannot lower the
 * result for any input, so:
 *   - a rail-gated outcome can STILL never be downgraded to `auto`
 *     (rail-gate always wins — original invariant intact), AND
 *   - a meta-rail `forbid` (mapped to `four_eyes`) forces the maximal
 *     decision and can never be relaxed by the controller or the rail.
 *
 * @param rail        collapsed verdict of the existing rail stack.
 * @param controller  the standalone output of `decideAutonomy`.
 * @param metaRail    OPTIONAL collapsed verdict of the meta-rail
 *                    (`checkBodyChangeInviolable`). Omitted (or `allow`)
 *                    for non-body-change calls. Defaults to `allow`, so
 *                    every existing call site is unchanged in behaviour.
 */
export function composeWithRail(
  rail: RailOutcome,
  controller: DecideAutonomyOutput,
  metaRail: MetaRailOutcome = 'allow',
): ComposedAutonomyOutput {
  const railDecision = railToDecision(rail);
  const metaRailDecision = metaRailToDecision(metaRail);

  // The MOST-cautious of every input — rail, controller, meta-rail.
  const decision = moreCautious(
    moreCautious(railDecision, controller.decision),
    metaRailDecision,
  );

  const railDominated = decision === railDecision && rail !== 'allow';
  const metaRailForbade = metaRail === 'forbid';

  const reasons: string[] = [
    `rail: outcome='${rail}' → ${railDecision}`,
    ...controller.reasons,
  ];

  if (metaRail === 'forbid') {
    reasons.push(
      `meta-rail: outcome='forbid' → ${metaRailDecision} (body-change inviolable; binding, cannot be weaker)`,
    );
  } else {
    reasons.push(`meta-rail: outcome='allow' → auto (no prohibited self-change)`);
  }

  if (rail !== 'allow') {
    reasons.push(
      `composition: rail-gate is binding — final cannot be weaker than '${railDecision}'`,
    );
  }
  if (decision !== controller.decision) {
    reasons.push(
      `composition: escalated from controller '${controller.decision}' to '${decision}'`,
    );
  } else if (rail !== 'allow' && railDecision !== controller.decision) {
    reasons.push(
      `composition: controller '${controller.decision}' already more cautious than rail '${railDecision}'`,
    );
  }

  // `gatedBy`: if the meta-rail forbade and set the final decision it is
  // the cause; else if the rail set (or tied for) the final decision the
  // rail is the cause; otherwise keep the controller's attribution.
  const gatedBy =
    decision === 'auto'
      ? null
      : metaRailForbade && decision === metaRailDecision
        ? ('situation' as const)
        : railDominated
          ? ('consequence' as const)
          : controller.gatedBy;

  return Object.freeze({
    decision,
    reasons: Object.freeze(reasons),
    gatedBy,
    railOutcome: rail,
    railDominated,
    metaRailOutcome: metaRail,
    metaRailForbade,
  });
}
