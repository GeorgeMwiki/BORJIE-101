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
import { composeWithRail, type RailOutcome } from '../compose-with-rail.js';
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
