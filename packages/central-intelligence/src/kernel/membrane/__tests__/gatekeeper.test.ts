/**
 * R7 — Gatekeeper composition tests.
 *
 * Proves the verifier composes the real-shaped checks (mocked ports): a
 * clean action certifies 'allow'; a policy-denied / cross-tenant /
 * empty-evidence / locale-mixed / killswitch-tripped / egress-leak /
 * rail-mutating / cohort-below-k-anon action certifies 'refuse'. Also
 * proves fail-closed: a port that throws records its invariant as
 * unsatisfied (never an exception out of evaluate).
 */

import { describe, it, expect } from 'vitest';
import {
  createGatekeeper,
  type GatekeeperAction,
  type GatekeeperDeps,
} from '../gatekeeper.js';

/** All-pass ports — the clean baseline. Tests override one at a time. */
function cleanDeps(overrides: Partial<GatekeeperDeps> = {}): GatekeeperDeps {
  let n = 0;
  return {
    policyGate: () => 'pass',
    inviolable: () => 'pass',
    killswitch: () => 'live',
    tenantScopeConsistent: () => true,
    evidenceChain: () => true,
    localePure: () => true,
    egressClean: () => true,
    kAnon: () => true,
    noRailMutation: () => true,
    now: () => 1234,
    newCertId: () => `cert_${(n += 1)}`,
    ...overrides,
  };
}

const cleanAction: GatekeeperAction = {
  actionRef: 'thought_1',
  tenantScope: 'tenant_a',
  isRecommendation: true,
};

describe('gatekeeper.evaluate — clean action allows', () => {
  it('certifies allow when every composed check passes', () => {
    const gk = createGatekeeper(cleanDeps());
    const cert = gk.evaluate(cleanAction);
    expect(cert.verdict).toBe('allow');
    expect(cert.actionRef).toBe('thought_1');
    expect(cert.tenantScope).toBe('tenant_a');
    // Every named invariant is recorded.
    expect(cert.invariantResults.length).toBe(8);
  });
});

describe('gatekeeper.evaluate — each rail refuses', () => {
  it('refuses when policy-gate blocks', () => {
    const gk = createGatekeeper(cleanDeps({ policyGate: () => 'block' }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses when inviolable blocks', () => {
    const gk = createGatekeeper(cleanDeps({ inviolable: () => 'block' }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses on cross-tenant (scope inconsistent)', () => {
    const gk = createGatekeeper(
      cleanDeps({ tenantScopeConsistent: () => false }),
    );
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses a recommendation with an empty evidence chain', () => {
    const gk = createGatekeeper(cleanDeps({ evidenceChain: () => false }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('allows a NON-recommendation even with empty evidence (not required)', () => {
    const gk = createGatekeeper(cleanDeps({ evidenceChain: () => false }));
    const cert = gk.evaluate({ ...cleanAction, isRecommendation: false });
    expect(cert.verdict).toBe('allow');
  });

  it('refuses on locale mixing', () => {
    const gk = createGatekeeper(cleanDeps({ localePure: () => false }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses on an egress leak', () => {
    const gk = createGatekeeper(cleanDeps({ egressClean: () => false }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses when the killswitch is tripped (halt)', () => {
    const gk = createGatekeeper(cleanDeps({ killswitch: () => 'halt' }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses when the action would mutate a rail', () => {
    const gk = createGatekeeper(cleanDeps({ noRailMutation: () => false }));
    expect(gk.evaluate(cleanAction).verdict).toBe('refuse');
  });

  it('refuses a cohort read below the k-anon floor', () => {
    const gk = createGatekeeper(cleanDeps({ kAnon: () => false }));
    const cert = gk.evaluate({ ...cleanAction, isCohortRead: true });
    expect(cert.verdict).toBe('refuse');
  });

  it('allows a non-cohort read regardless of k-anon (not required)', () => {
    const gk = createGatekeeper(cleanDeps({ kAnon: () => false }));
    const cert = gk.evaluate({ ...cleanAction, isCohortRead: false });
    expect(cert.verdict).toBe('allow');
  });
});

describe('gatekeeper.evaluate — fail-closed + chaining', () => {
  it('never throws when a port throws; records the invariant as unsatisfied', () => {
    const gk = createGatekeeper(
      cleanDeps({
        policyGate: () => {
          throw new Error('boom');
        },
      }),
    );
    let cert!: ReturnType<typeof gk.evaluate>;
    expect(() => {
      cert = gk.evaluate(cleanAction);
    }).not.toThrow();
    expect(cert.verdict).toBe('refuse');
    const policy = cert.invariantResults.find(
      (r) => r.name === 'policy-gate-allowed',
    );
    expect(policy?.satisfied).toBe(false);
  });

  it('chains off the supplied prevHash', () => {
    const gk = createGatekeeper(cleanDeps());
    const first = gk.evaluate(cleanAction);
    const second = gk.evaluate(cleanAction, { prevHash: first.hash });
    expect(second.priorHash).toBe(first.hash);
  });
});
