/**
 * Body-change syscall — the ONE chokepoint for self-change.
 *
 * Proves the syscall composes the three governance primitives (meta-rail
 * + controller + composeWithRail) and FAILS CLOSED on any defect:
 *
 *   - meta-rail forbid          → four_eyes, authorized=false (binding).
 *   - rail-gate always wins      → a rail gate/four_eyes can never auto.
 *   - missing / throwing port    → fail-closed deny.
 *   - malformed verdicts         → fail-closed deny.
 *   - clean allow path           → authorized=true ONLY when final=auto.
 *
 * The ports are injected fakes; in production the composition root binds
 * `checkBodyChangeInviolable` / `decideAutonomy` / `composeWithRail`.
 */

import { describe, it, expect } from 'vitest';
import {
  authorizeBodyChange,
  type BodyChangeRequest,
  type BodyChangeSyscallPorts,
  type BodyChangeAutonomyDecision,
  type BodyChangeMetaRailOutcome,
  type BodyChangeRailOutcome,
} from '../body-change/body-change-syscall.js';

const RANK: Record<BodyChangeAutonomyDecision, number> = {
  auto: 0,
  gate: 1,
  four_eyes: 2,
};

function railFloor(rail: BodyChangeRailOutcome): BodyChangeAutonomyDecision {
  return rail === 'allow' ? 'auto' : rail;
}

/**
 * A FAITHFUL fake of the production composer: the monotone-most-cautious
 * max over rail + controller + meta-rail. Mirrors the real
 * `composeWithRail` so the syscall's post-condition assertions are
 * exercised against correct behaviour.
 */
const faithfulCompose: BodyChangeSyscallPorts['composeWithRail'] = {
  compose(rail, controller, metaRail) {
    const metaFloor: BodyChangeAutonomyDecision =
      metaRail === 'forbid' ? 'four_eyes' : 'auto';
    const max = Math.max(
      RANK[railFloor(rail)],
      RANK[controller.decision],
      RANK[metaFloor],
    );
    const decision = (Object.keys(RANK) as BodyChangeAutonomyDecision[]).find(
      (d) => RANK[d] === max,
    ) as BodyChangeAutonomyDecision;
    return {
      decision,
      reasons: [`fake-compose → ${decision}`],
      metaRailForbade: metaRail === 'forbid',
      railDominated: decision === railFloor(rail) && rail !== 'allow',
    };
  },
};

function ports(args: {
  readonly meta?: BodyChangeMetaRailOutcome;
  readonly controller?: BodyChangeAutonomyDecision;
  readonly compose?: BodyChangeSyscallPorts['composeWithRail'];
  readonly metaThrows?: boolean;
  readonly controllerThrows?: boolean;
}): BodyChangeSyscallPorts {
  return {
    metaRail: {
      check() {
        if (args.metaThrows) throw new Error('meta boom');
        return { status: args.meta ?? 'allow' };
      },
    },
    controller: {
      decide() {
        if (args.controllerThrows) throw new Error('controller boom');
        return {
          decision: args.controller ?? 'auto',
          reasons: [`controller → ${args.controller ?? 'auto'}`],
          gatedBy: (args.controller ?? 'auto') === 'auto' ? null : 'confidence',
        };
      },
    },
    composeWithRail: args.compose ?? faithfulCompose,
  };
}

function request(overrides: Partial<BodyChangeRequest> = {}): BodyChangeRequest {
  return {
    tenantId: 't1',
    targetNodeId: 'surface.owner-web.royalties-tab',
    descriptor: { kind: 'ui-move', targetNodeId: 'surface.owner-web.royalties-tab' },
    railOutcome: 'allow',
    controllerInput: {},
    ...overrides,
  };
}

describe('authorizeBodyChange — clean allow path', () => {
  it('authorizes when meta=allow, rail=allow, controller=auto', () => {
    const v = authorizeBodyChange(request(), ports({}));
    expect(v.authorized).toBe(true);
    expect(v.decision).toBe('auto');
    expect(v.failedClosed).toBe(false);
    expect(v.metaRailForbade).toBe(false);
  });
});

describe('authorizeBodyChange — meta-rail forbid is binding', () => {
  it('denies + four_eyes when meta=forbid even with the safest inputs', () => {
    const v = authorizeBodyChange(request(), ports({ meta: 'forbid' }));
    expect(v.authorized).toBe(false);
    expect(v.decision).toBe('four_eyes');
    expect(v.metaRailForbade).toBe(true);
    expect(v.failedClosed).toBe(false);
  });
});

describe('authorizeBodyChange — rail-gate always wins', () => {
  const RAILS: ReadonlyArray<BodyChangeRailOutcome> = ['allow', 'gate', 'four_eyes'];
  const CTRLS: ReadonlyArray<BodyChangeAutonomyDecision> = ['auto', 'gate', 'four_eyes'];
  const METAS: ReadonlyArray<BodyChangeMetaRailOutcome> = ['allow', 'forbid'];

  for (const rail of RAILS) {
    for (const controller of CTRLS) {
      for (const meta of METAS) {
        it(`rail=${rail} controller=${controller} meta=${meta} is never weaker than any input`, () => {
          const v = authorizeBodyChange(
            request({ railOutcome: rail }),
            ports({ controller, meta }),
          );
          const metaFloor = meta === 'forbid' ? RANK.four_eyes : RANK.auto;
          const expected = Math.max(
            RANK[railFloor(rail)],
            RANK[controller],
            metaFloor,
          );
          expect(RANK[v.decision]).toBe(expected);
          // authorized iff final is auto.
          expect(v.authorized).toBe(v.decision === 'auto');
        });
      }
    }
  }

  it('a rail-gated change is never authorized', () => {
    const v = authorizeBodyChange(
      request({ railOutcome: 'gate' }),
      ports({ controller: 'auto', meta: 'allow' }),
    );
    expect(v.authorized).toBe(false);
    expect(v.decision).not.toBe('auto');
  });
});

describe('authorizeBodyChange — FAIL-CLOSED', () => {
  it('denies when the request has no targetNodeId', () => {
    const v = authorizeBodyChange(
      request({ targetNodeId: '' }),
      ports({}),
    );
    expect(v.authorized).toBe(false);
    expect(v.failedClosed).toBe(true);
    expect(v.decision).toBe('four_eyes');
  });

  it('denies on an invalid railOutcome', () => {
    const v = authorizeBodyChange(
      // @ts-expect-error — deliberately invalid.
      request({ railOutcome: 'maybe' }),
      ports({}),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when a governance port is missing', () => {
    const v = authorizeBodyChange(request(), {
      // @ts-expect-error — deliberately missing controller + composer.
      metaRail: { check: () => ({ status: 'allow' }) },
    });
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when the meta-rail port throws', () => {
    const v = authorizeBodyChange(request(), ports({ metaThrows: true }));
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
    expect(v.reasons.join('\n')).toContain('meta-rail threw');
  });

  it('denies when the controller port throws', () => {
    const v = authorizeBodyChange(request(), ports({ controllerThrows: true }));
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
    expect(v.reasons.join('\n')).toContain('controller threw');
  });

  it('denies when the meta-rail returns a malformed verdict', () => {
    const v = authorizeBodyChange(request(), {
      metaRail: { check: () => ({ status: 'whoops' as unknown as 'allow' }) },
      controller: ports({}).controller,
      composeWithRail: faithfulCompose,
    });
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when the composer downgrades a meta-rail forbid (defence-in-depth)', () => {
    const lyingCompose: BodyChangeSyscallPorts['composeWithRail'] = {
      compose: () => ({
        decision: 'auto',
        reasons: ['lying composer'],
        metaRailForbade: false,
        railDominated: false,
      }),
    };
    const v = authorizeBodyChange(
      request(),
      ports({ meta: 'forbid', compose: lyingCompose }),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
    expect(v.reasons.join('\n')).toContain('did not escalate to four_eyes');
  });

  it('denies when the composer downgrades a rail four_eyes (defence-in-depth)', () => {
    const lyingCompose: BodyChangeSyscallPorts['composeWithRail'] = {
      compose: () => ({
        decision: 'gate',
        reasons: ['lying composer'],
        metaRailForbade: false,
        railDominated: false,
      }),
    };
    const v = authorizeBodyChange(
      request({ railOutcome: 'four_eyes' }),
      ports({ compose: lyingCompose }),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });

  it('denies when the composer downgrades a rail gate to auto (defence-in-depth)', () => {
    const lyingCompose: BodyChangeSyscallPorts['composeWithRail'] = {
      compose: () => ({
        decision: 'auto',
        reasons: ['lying composer'],
        metaRailForbade: false,
        railDominated: false,
      }),
    };
    const v = authorizeBodyChange(
      request({ railOutcome: 'gate' }),
      ports({ compose: lyingCompose }),
    );
    expect(v.failedClosed).toBe(true);
    expect(v.authorized).toBe(false);
  });
});

describe('authorizeBodyChange — output shape', () => {
  it('returns a frozen verdict with non-empty reasons', () => {
    const v = authorizeBodyChange(request(), ports({}));
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.reasons)).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});
