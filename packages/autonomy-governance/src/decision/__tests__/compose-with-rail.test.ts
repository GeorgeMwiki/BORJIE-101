/**
 * composeWithRail — the load-bearing composition invariant.
 *
 * The continuous controller is ADDITIVE: it can only ESCALATE. The
 * single non-negotiable contract is "RAIL-GATE ALWAYS WINS" — a
 * rail-gated action can NEVER be turned into `auto`, while a rail-allowed
 * action MAY be turned into a gate.
 *
 * This suite pins that invariant exhaustively (every rail × every
 * controller decision) plus the directional rules.
 */

import { describe, it, expect } from 'vitest';
import {
  composeWithRail,
  type RailOutcome,
  type MetaRailOutcome,
} from '../compose-with-rail.js';
import { decideAutonomy } from '../decide-autonomy.js';
import type {
  AutonomyDecision,
  DecideAutonomyOutput,
} from '../types.js';

const RANK: Record<AutonomyDecision, number> = {
  auto: 0,
  gate: 1,
  four_eyes: 2,
};

const RAIL_OUTCOMES: ReadonlyArray<RailOutcome> = [
  'allow',
  'gate',
  'four_eyes',
];
const CONTROLLER_DECISIONS: ReadonlyArray<AutonomyDecision> = [
  'auto',
  'gate',
  'four_eyes',
];

function controllerStub(decision: AutonomyDecision): DecideAutonomyOutput {
  return Object.freeze({
    decision,
    reasons: Object.freeze([`stub controller → ${decision}`]),
    gatedBy: decision === 'auto' ? null : ('confidence' as const),
  });
}

function railFloor(rail: RailOutcome): AutonomyDecision {
  return rail === 'allow' ? 'auto' : rail;
}

describe('composeWithRail — INVARIANT: rail-gate always wins', () => {
  for (const rail of RAIL_OUTCOMES) {
    for (const controllerDecision of CONTROLLER_DECISIONS) {
      it(`rail='${rail}' × controller='${controllerDecision}' is never weaker than the rail`, () => {
        const out = composeWithRail(rail, controllerStub(controllerDecision));
        // Final is at least as cautious as the rail floor.
        expect(RANK[out.decision]).toBeGreaterThanOrEqual(RANK[railFloor(rail)]);
        // Final is at least as cautious as the controller too (additive).
        expect(RANK[out.decision]).toBeGreaterThanOrEqual(
          RANK[controllerDecision],
        );
        // Exactly the max of the two.
        expect(RANK[out.decision]).toBe(
          Math.max(RANK[railFloor(rail)], RANK[controllerDecision]),
        );
      });
    }
  }

  it('a rail-GATED action can NEVER be downgraded to auto', () => {
    for (const rail of ['gate', 'four_eyes'] as const) {
      const out = composeWithRail(rail, controllerStub('auto'));
      expect(out.decision).not.toBe('auto');
      expect(RANK[out.decision]).toBeGreaterThanOrEqual(RANK[railFloor(rail)]);
    }
  });

  it('a rail-four_eyes action can NEVER be downgraded to gate or auto', () => {
    for (const controllerDecision of CONTROLLER_DECISIONS) {
      const out = composeWithRail('four_eyes', controllerStub(controllerDecision));
      expect(out.decision).toBe('four_eyes');
    }
  });
});

describe('composeWithRail — controller may only ADD gating', () => {
  it('rail allows but controller gates → final gates (controller escalates)', () => {
    const out = composeWithRail('allow', controllerStub('gate'));
    expect(out.decision).toBe('gate');
    expect(out.railDominated).toBe(false);
    expect(out.gatedBy).toBe('confidence');
  });

  it('rail allows but controller four_eyes → final four_eyes', () => {
    const out = composeWithRail('allow', controllerStub('four_eyes'));
    expect(out.decision).toBe('four_eyes');
    expect(out.railDominated).toBe(false);
  });

  it('rail allows and controller auto → final auto (no escalation)', () => {
    const out = composeWithRail('allow', controllerStub('auto'));
    expect(out.decision).toBe('auto');
    expect(out.gatedBy).toBeNull();
    expect(out.railDominated).toBe(false);
  });

  it('rail gates and controller gates → final gate, rail dominated', () => {
    const out = composeWithRail('gate', controllerStub('gate'));
    expect(out.decision).toBe('gate');
    expect(out.railDominated).toBe(true);
  });

  it('rail gates and controller four_eyes → controller wins (more cautious)', () => {
    const out = composeWithRail('gate', controllerStub('four_eyes'));
    expect(out.decision).toBe('four_eyes');
    // The controller, not the rail, set the final decision.
    expect(out.railDominated).toBe(false);
    expect(out.gatedBy).toBe('confidence');
  });
});

describe('composeWithRail — output shape + reasons', () => {
  it('echoes the rail outcome and is frozen', () => {
    const out = composeWithRail('gate', controllerStub('auto'));
    expect(out.railOutcome).toBe('gate');
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.reasons)).toBe(true);
  });

  it('reasons include the rail line and the binding note when gated', () => {
    const out = composeWithRail('four_eyes', controllerStub('auto'));
    const joined = out.reasons.join('\n');
    expect(joined).toContain("rail: outcome='four_eyes'");
    expect(joined).toContain('rail-gate is binding');
  });

  it('reasons preserve the controller reasons', () => {
    const out = composeWithRail('allow', controllerStub('gate'));
    expect(out.reasons.join('\n')).toContain('stub controller → gate');
  });
});

describe('composeWithRail — integration with the real decideAutonomy', () => {
  it('rail-gate beats a real controller "auto" recommendation', () => {
    // A genuinely safe action the controller would auto.
    const controller = decideAutonomy({
      calibratedConfidence: 1,
      consequenceTier: 'trivial',
      reversibility: 'reversible',
      mandate: 'operator',
    });
    expect(controller.decision).toBe('auto');

    // But a rail (e.g. policy-gate block / sovereign) gates it.
    const composed = composeWithRail('four_eyes', controller);
    expect(composed.decision).toBe('four_eyes');
    expect(composed.railDominated).toBe(true);
  });

  it('controller escalates a rail-allowed action when calibration is weak', () => {
    const controller = decideAutonomy({
      calibratedConfidence: 0.3,
      consequenceTier: 'moderate',
      reversibility: 'reversible',
      mandate: 'operator',
    });
    expect(controller.decision).toBe('gate');

    const composed = composeWithRail('allow', controller);
    expect(composed.decision).toBe('gate');
    expect(composed.railDominated).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// META-RAIL composition — the third monotone input. A meta-rail `forbid`
// forces `four_eyes` and can NEVER be downgraded; an `allow` (or the
// default) is a no-op so the original rail-gate proof is intact.
// ═══════════════════════════════════════════════════════════════════════

const META_OUTCOMES: ReadonlyArray<MetaRailOutcome> = ['allow', 'forbid'];

describe('composeWithRail — META-RAIL is one more monotone input', () => {
  it('defaults metaRail to allow (backward compatible 2-arg call)', () => {
    const out = composeWithRail('allow', controllerStub('auto'));
    expect(out.metaRailOutcome).toBe('allow');
    expect(out.metaRailForbade).toBe(false);
    expect(out.decision).toBe('auto');
  });

  it('explicit metaRail=allow is identical to the default', () => {
    const a = composeWithRail('allow', controllerStub('auto'));
    const b = composeWithRail('allow', controllerStub('auto'), 'allow');
    expect(b.decision).toBe(a.decision);
    expect(b.metaRailForbade).toBe(false);
  });

  it('exhaustive: final is the MAX over rail × controller × meta-rail', () => {
    for (const rail of RAIL_OUTCOMES) {
      for (const controllerDecision of CONTROLLER_DECISIONS) {
        for (const meta of META_OUTCOMES) {
          const out = composeWithRail(
            rail,
            controllerStub(controllerDecision),
            meta,
          );
          const metaFloor = meta === 'forbid' ? RANK.four_eyes : RANK.auto;
          const expected = Math.max(
            RANK[railFloor(rail)],
            RANK[controllerDecision],
            metaFloor,
          );
          expect(RANK[out.decision]).toBe(expected);
          // Monotone: never weaker than ANY single input.
          expect(RANK[out.decision]).toBeGreaterThanOrEqual(RANK[railFloor(rail)]);
          expect(RANK[out.decision]).toBeGreaterThanOrEqual(RANK[controllerDecision]);
          expect(RANK[out.decision]).toBeGreaterThanOrEqual(metaFloor);
        }
      }
    }
  });

  it('a meta-rail FORBID forces four_eyes regardless of rail/controller', () => {
    for (const rail of RAIL_OUTCOMES) {
      for (const controllerDecision of CONTROLLER_DECISIONS) {
        const out = composeWithRail(rail, controllerStub(controllerDecision), 'forbid');
        expect(out.decision).toBe('four_eyes');
        expect(out.metaRailForbade).toBe(true);
      }
    }
  });

  it('a meta-rail forbid can NEVER be downgraded to auto even with the safest inputs', () => {
    const out = composeWithRail('allow', controllerStub('auto'), 'forbid');
    expect(out.decision).toBe('four_eyes');
    expect(out.metaRailForbade).toBe(true);
    expect(out.gatedBy).toBe('situation');
  });

  it('the original rail-gate invariant still holds WITH the meta-rail allowed', () => {
    // Adding the meta-rail (allow) does not relax rail-gate.
    const out = composeWithRail('four_eyes', controllerStub('auto'), 'allow');
    expect(out.decision).toBe('four_eyes');
    expect(out.railDominated).toBe(true);
  });

  it('meta-rail forbid attribution wins gatedBy when it sets the decision', () => {
    const out = composeWithRail('allow', controllerStub('auto'), 'forbid');
    expect(out.gatedBy).toBe('situation');
  });

  it('reasons surface the meta-rail outcome', () => {
    const forbidOut = composeWithRail('allow', controllerStub('auto'), 'forbid');
    expect(forbidOut.reasons.join('\n')).toContain("meta-rail: outcome='forbid'");
    const allowOut = composeWithRail('allow', controllerStub('auto'), 'allow');
    expect(allowOut.reasons.join('\n')).toContain("meta-rail: outcome='allow'");
  });

  it('integration: a real controller "auto" is forced to four_eyes by a meta-rail forbid', () => {
    const controller = decideAutonomy({
      calibratedConfidence: 1,
      consequenceTier: 'trivial',
      reversibility: 'reversible',
      mandate: 'operator',
    });
    expect(controller.decision).toBe('auto');
    const composed = composeWithRail('allow', controller, 'forbid');
    expect(composed.decision).toBe('four_eyes');
    expect(composed.metaRailForbade).toBe(true);
  });
});
