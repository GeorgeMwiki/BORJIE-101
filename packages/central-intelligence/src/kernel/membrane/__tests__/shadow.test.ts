/**
 * R7 — Shadow-mode behavior-preservation tests.
 *
 * Proves the keystone shadow contract:
 *   - the hook EMITS a certificate + REPORTS divergence, but
 *   - it NEVER changes the kernel's allow/deny outcome (the hook is void —
 *     there is nothing to override the existing decision WITH), and
 *   - it is CI-inert: absent gatekeeper → pure no-op (no emit, no report), and
 *   - it never throws, even when the sink / reporter / gatekeeper throw.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runShadowGatekeeper,
  type SafetyCertificateSink,
  type ShadowDivergenceEvent,
} from '../shadow.js';
import {
  createGatekeeper,
  type GatekeeperDeps,
} from '../gatekeeper.js';
import type { SafetyCertificate } from '../certificate.js';

function gatekeeper(overrides: Partial<GatekeeperDeps> = {}) {
  let n = 0;
  return createGatekeeper({
    policyGate: () => 'pass',
    inviolable: () => 'pass',
    killswitch: () => 'live',
    tenantScopeConsistent: () => true,
    evidenceChain: () => true,
    localePure: () => true,
    egressClean: () => true,
    kAnon: () => true,
    noRailMutation: () => true,
    now: () => 42,
    newCertId: () => `cert_${(n += 1)}`,
    ...overrides,
  });
}

const action = { actionRef: 'thought_1', tenantScope: 'tenant_a' };

describe('runShadowGatekeeper — emits + reports without enforcing', () => {
  it('emits a certificate and reports NO divergence when verdicts agree', () => {
    const emitted: SafetyCertificate[] = [];
    const events: ShadowDivergenceEvent[] = [];
    const sink: SafetyCertificateSink = { emit: (c) => void emitted.push(c) };

    runShadowGatekeeper(
      {
        gatekeeper: gatekeeper(),
        certificateSink: sink,
        onDivergence: (e) => void events.push(e),
      },
      { action, existingDecision: 'allow' },
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.verdict).toBe('allow');
    expect(events).toHaveLength(1);
    expect(events[0]?.diverged).toBe(false);
    expect(events[0]?.certHash).toBe(emitted[0]?.hash);
  });

  it('reports divergence when the certificate refuses but the kernel allowed — WITHOUT changing anything', () => {
    const events: ShadowDivergenceEvent[] = [];
    // Gatekeeper refuses (policy blocks), but the existing decision allowed.
    runShadowGatekeeper(
      {
        gatekeeper: gatekeeper({ policyGate: () => 'block' }),
        onDivergence: (e) => void events.push(e),
      },
      { action, existingDecision: 'allow' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.certificateVerdict).toBe('refuse');
    expect(events[0]?.existingDecision).toBe('allow');
    expect(events[0]?.diverged).toBe(true);
  });

  it('returns void — it can NOT carry an override back to the caller', () => {
    const result = runShadowGatekeeper(
      { gatekeeper: gatekeeper({ policyGate: () => 'block' }) },
      { action, existingDecision: 'allow' },
    );
    // The behavior-preservation guarantee at the type level: nothing to act on.
    expect(result).toBeUndefined();
  });
});

describe('runShadowGatekeeper — CI-inert + fail-closed', () => {
  it('is a pure no-op when no gatekeeper is wired (CI path)', () => {
    const emit = vi.fn();
    const onDivergence = vi.fn();
    runShadowGatekeeper(
      { certificateSink: { emit }, onDivergence },
      { action, existingDecision: 'allow' },
    );
    expect(emit).not.toHaveBeenCalled();
    expect(onDivergence).not.toHaveBeenCalled();
  });

  it('never throws when the sink throws', () => {
    expect(() =>
      runShadowGatekeeper(
        {
          gatekeeper: gatekeeper(),
          certificateSink: {
            emit: () => {
              throw new Error('sink down');
            },
          },
        },
        { action, existingDecision: 'allow' },
      ),
    ).not.toThrow();
  });

  it('never throws when the reporter throws', () => {
    expect(() =>
      runShadowGatekeeper(
        {
          gatekeeper: gatekeeper(),
          onDivergence: () => {
            throw new Error('reporter down');
          },
        },
        { action, existingDecision: 'allow' },
      ),
    ).not.toThrow();
  });

  it('chains the next certificate off the sink head hash when provided', () => {
    const emitted: SafetyCertificate[] = [];
    const sink: SafetyCertificateSink = {
      emit: (c) => void emitted.push(c),
      headHash: () => 'deadbeef',
    };
    runShadowGatekeeper(
      { gatekeeper: gatekeeper(), certificateSink: sink },
      { action, existingDecision: 'allow' },
    );
    expect(emitted[0]?.priorHash).toBe('deadbeef');
  });

  it('swallows an async sink rejection without throwing', async () => {
    const sink: SafetyCertificateSink = {
      emit: () => Promise.reject(new Error('async down')),
    };
    expect(() =>
      runShadowGatekeeper(
        { gatekeeper: gatekeeper(), certificateSink: sink },
        { action, existingDecision: 'allow' },
      ),
    ).not.toThrow();
    // Let the swallowed rejection settle.
    await Promise.resolve();
  });
});
