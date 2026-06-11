/**
 * authorizeSelfExtension — the kernel/orchestrator body-change entry.
 *
 * A sub-MD deployment is an L3 body-change; it MUST route through the
 * unified governance composition (meta-rail + controller + composeWithRail).
 * These tests prove:
 *
 *   - the meta-rail (checkBodyChangeInviolable) runs and binds: a
 *     rail-editing / integrity-failing descriptor → four_eyes deny.
 *   - rail-gate always wins through the entry.
 *   - FAIL-CLOSED on any missing/throwing port or malformed verdict.
 *   - authorized=true ONLY when the composed decision is auto.
 */

import { describe, it, expect } from 'vitest';
import {
  authorizeSelfExtension,
  type AuthorizeSelfExtensionArgs,
  type SelfExtensionGovernancePorts,
  type SelfExtensionAutonomyDecision,
  type SelfExtensionRailOutcome,
} from '../self-extension.js';
import type { BodyChangeDescriptor } from '../../inviolable.js';

const RANK: Record<SelfExtensionAutonomyDecision, number> = {
  auto: 0,
  gate: 1,
  four_eyes: 2,
};

function railFloor(rail: SelfExtensionRailOutcome): SelfExtensionAutonomyDecision {
  return rail === 'allow' ? 'auto' : rail;
}

/** Faithful monotone-most-cautious composer (mirrors composeWithRail). */
const faithfulCompose: SelfExtensionGovernancePorts['composeWithRail'] = {
  compose(rail, controller, metaRail) {
    const metaFloor: SelfExtensionAutonomyDecision =
      metaRail === 'forbid' ? 'four_eyes' : 'auto';
    const max = Math.max(
      RANK[railFloor(rail)],
      RANK[controller.decision],
      RANK[metaFloor],
    );
    const decision = (Object.keys(RANK) as SelfExtensionAutonomyDecision[]).find(
      (d) => RANK[d] === max,
    ) as SelfExtensionAutonomyDecision;
    return {
      decision,
      reasons: [`compose → ${decision}`],
      metaRailForbade: metaRail === 'forbid',
      railDominated: decision === railFloor(rail) && rail !== 'allow',
    };
  },
};

function ports(args: {
  readonly controller?: SelfExtensionAutonomyDecision;
  readonly controllerThrows?: boolean;
  readonly compose?: SelfExtensionGovernancePorts['composeWithRail'];
}): SelfExtensionGovernancePorts {
  return {
    controller: {
      decide() {
        if (args.controllerThrows) throw new Error('controller boom');
        const d = args.controller ?? 'auto';
        return { decision: d, reasons: [`ctrl → ${d}`], gatedBy: d === 'auto' ? null : 'confidence' };
      },
    },
    composeWithRail: args.compose ?? faithfulCompose,
  };
}

function benignDescriptor(): BodyChangeDescriptor {
  return { kind: 'sub-md-compose', targetNodeId: 'submd.proposed.metallurgy-v2' };
}

function args(overrides: Partial<AuthorizeSelfExtensionArgs> = {}): AuthorizeSelfExtensionArgs {
  return {
    descriptor: benignDescriptor(),
    railOutcome: 'allow',
    controllerInput: {},
    ...overrides,
  };
}

describe('authorizeSelfExtension — clean allow path', () => {
  it('authorizes a benign sub-MD compose when everything passes', () => {
    const v = authorizeSelfExtension(args(), ports({}));
    expect(v.authorized).toBe(true);
    expect(v.decision).toBe('auto');
    expect(v.metaRailVerdict.status).toBe('allow');
    expect(v.failedClosed).toBe(false);
  });
});

describe('authorizeSelfExtension — meta-rail binds', () => {
  it('denies when the descriptor edits a rail node', () => {
    const v = authorizeSelfExtension(
      args({ descriptor: { kind: 'code-patch', targetNodeId: 'kernel.inviolable' } }),
      ports({}),
    );
    expect(v.authorized).toBe(false);
    expect(v.decision).toBe('four_eyes');
    expect(v.metaRailForbade).toBe(true);
    expect(v.metaRailVerdict.status).toBe('forbid');
    expect(v.metaRailVerdict.category).toBe('rail-edit');
  });

  it('denies when the descriptor raises an autonomy ceiling', () => {
    const v = authorizeSelfExtension(
      args({
        descriptor: {
          kind: 'self-model-edit',
          targetNodeId: 'submd.x',
          ceilingBefore: 'gate',
          ceilingAfter: 'operator',
        },
      }),
      ports({}),
    );
    expect(v.authorized).toBe(false);
    expect(v.metaRailVerdict.category).toBe('ceiling-raise');
  });

  it('denies on an integrity failure', () => {
    const v = authorizeSelfExtension(
      args({
        descriptor: {
          kind: 'sub-md-compose',
          targetNodeId: 'submd.x',
          expectedIntegrityHash: 'a',
          computedIntegrityHash: 'b',
          priorChainLinkVerified: true,
        },
      }),
      ports({}),
    );
    expect(v.authorized).toBe(false);
    expect(v.metaRailVerdict.category).toBe('integrity-failure');
  });
});

describe('authorizeSelfExtension — rail-gate always wins', () => {
  const RAILS: ReadonlyArray<SelfExtensionRailOutcome> = ['allow', 'gate', 'four_eyes'];
  const CTRLS: ReadonlyArray<SelfExtensionAutonomyDecision> = ['auto', 'gate', 'four_eyes'];

  for (const rail of RAILS) {
    for (const controller of CTRLS) {
      it(`rail=${rail} controller=${controller} is never weaker than either`, () => {
        const v = authorizeSelfExtension(
          args({ railOutcome: rail }),
          ports({ controller }),
        );
        const expected = Math.max(RANK[railFloor(rail)], RANK[controller]);
        expect(RANK[v.decision]).toBe(expected);
        expect(v.authorized).toBe(v.decision === 'auto');
      });
    }
  }

  it('a rail-gated deployment is never authorized', () => {
    const v = authorizeSelfExtension(args({ railOutcome: 'gate' }), ports({ controller: 'auto' }));
    expect(v.authorized).toBe(false);
  });
});

describe('authorizeSelfExtension — FAIL-CLOSED', () => {
  it('denies when a governance port is missing', () => {
    // @ts-expect-error — deliberately missing composer.
    const v = authorizeSelfExtension(args(), { controller: ports({}).controller });
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when the controller port throws', () => {
    const v = authorizeSelfExtension(args(), ports({ controllerThrows: true }));
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
    expect(v.reasons.join('\n')).toContain('controller threw');
  });

  it('denies on an invalid railOutcome', () => {
    const v = authorizeSelfExtension(
      // @ts-expect-error — deliberately invalid.
      args({ railOutcome: 'perhaps' }),
      ports({}),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when the composer downgrades a meta-rail forbid (defence-in-depth)', () => {
    const lying: SelfExtensionGovernancePorts['composeWithRail'] = {
      compose: () => ({ decision: 'auto', reasons: ['lie'], metaRailForbade: false, railDominated: false }),
    };
    const v = authorizeSelfExtension(
      args({ descriptor: { kind: 'code-patch', targetNodeId: 'kernel.policy-gate' } }),
      ports({ compose: lying }),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
    expect(v.reasons.join('\n')).toContain('did not escalate to four_eyes');
  });

  it('denies when the composer downgrades a rail four_eyes (defence-in-depth)', () => {
    const lying: SelfExtensionGovernancePorts['composeWithRail'] = {
      compose: () => ({ decision: 'gate', reasons: ['lie'], metaRailForbade: false, railDominated: false }),
    };
    const v = authorizeSelfExtension(args({ railOutcome: 'four_eyes' }), ports({ compose: lying }));
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });
});

describe('authorizeSelfExtension — output shape', () => {
  it('returns a frozen verdict with non-empty reasons', () => {
    const v = authorizeSelfExtension(args(), ports({}));
    expect(Object.isFrozen(v)).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});
