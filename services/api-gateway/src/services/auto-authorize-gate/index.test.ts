/**
 * auto-authorize gate — safety-critical unit coverage.
 *
 * `decideAutoAuthorization` is the gate that decides whether a teaching-LLM
 * `<auto_authorized>` tag may actually be presented to the UI as an
 * authorization. A regression here re-opens the original safety gap (an
 * unvalidated model string treated as an authorization), so this suite
 * pins the four invariants from CLAUDE.md:
 *
 *   (a) every HIGH-risk policy prefix (sovereign / kill_switch / four_eye /
 *       policy_rollout) is DENIED;
 *   (b) an inviolable `block` verdict is DENIED;
 *   (c) a benign action with all gates passing is AUTHORIZED;
 *   (d) FAIL-CLOSED — any thrown error inside a gate DENIES, never authorizes.
 *
 * The kernel (`@borjie/central-intelligence`) is mocked so the gate's own
 * branching — not the kernel's internals — is what's under test. The
 * HIGH-risk prefix branch short-circuits before the kernel is consulted, so
 * (a) holds regardless of the mock; (b)/(c)/(d) drive the mock directly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScopeContext } from '@borjie/central-intelligence';
import { decideAutoAuthorization, screenGenerativeVerb } from './index.js';
import {
  checkInviolable,
  runPolicyGate,
  isHighRiskLiteralOnly,
} from '@borjie/central-intelligence';

vi.mock('@borjie/central-intelligence', () => ({
  // Default-safe (pass) stubs; individual tests override as needed. The
  // benign path requires all three to resolve "allow".
  checkInviolable: vi.fn(() => ({ status: 'pass' as const })),
  runPolicyGate: vi.fn(() => ({
    verdict: { status: 'pass' as const },
    redactedText: '',
    mutations: [],
  })),
  isHighRiskLiteralOnly: vi.fn(() => false),
}));

const mockedCheckInviolable = vi.mocked(checkInviolable);
const mockedRunPolicyGate = vi.mocked(runPolicyGate);
const mockedIsHighRiskLiteralOnly = vi.mocked(isHighRiskLiteralOnly);

const tenantScope: ScopeContext = {
  kind: 'tenant',
  tenantId: 'tenant-test',
  actorUserId: 'user-test',
  roles: ['owner'],
  personaId: 'mr-mwikila-head',
};

beforeEach(() => {
  // Reset to the default-safe (allow) posture before each case.
  mockedCheckInviolable.mockReset().mockReturnValue({ status: 'pass' });
  mockedRunPolicyGate.mockReset().mockReturnValue({
    verdict: { status: 'pass' },
    redactedText: '',
    mutations: [],
  });
  mockedIsHighRiskLiteralOnly.mockReset().mockReturnValue(false);
});

describe('decideAutoAuthorization — HIGH-risk prefix gate (a)', () => {
  const highRiskActions = [
    'sovereign:transfer',
    'sovereign_freeze',
    'kill_switch:engage',
    'killswitch-all',
    'four_eye:approve',
    'four-eye_release',
    'policy_rollout:wave-3',
  ];

  for (const action of highRiskActions) {
    it(`denies HIGH-risk action "${action}" before consulting the kernel`, () => {
      const decision = decideAutoAuthorization(action, 'because reasons', tenantScope);
      expect(decision.authorized).toBe(false);
      // The prefix branch short-circuits — the kernel gates are never reached.
      expect(mockedCheckInviolable).not.toHaveBeenCalled();
      expect(mockedRunPolicyGate).not.toHaveBeenCalled();
    });
  }

  it('denies an action flagged by the kernel literal-only list', () => {
    mockedIsHighRiskLiteralOnly.mockReturnValue(true);
    const decision = decideAutoAuthorization('md:money_transfer', 'move funds', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toContain('literal-only');
  });
});

describe('decideAutoAuthorization — inviolable gate (b)', () => {
  it('denies when checkInviolable returns a block verdict', () => {
    mockedCheckInviolable.mockReturnValue({
      status: 'block',
      category: 'cross-tenant',
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'tidy inbox', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('inviolable:cross-tenant');
    // Policy gate must not run once the inviolable gate has blocked.
    expect(mockedRunPolicyGate).not.toHaveBeenCalled();
  });
});

describe('decideAutoAuthorization — benign authorize path (c)', () => {
  it('authorizes a benign action when every gate passes', () => {
    const decision = decideAutoAuthorization(
      'snooze_reminder',
      'low-stakes reminder snooze',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
    expect(decision.reason).toBe('authorized');
    expect(mockedCheckInviolable).toHaveBeenCalledTimes(1);
    expect(mockedRunPolicyGate).toHaveBeenCalledTimes(1);
  });

  it('denies a benign action when the policy gate blocks', () => {
    mockedRunPolicyGate.mockReturnValue({
      verdict: { status: 'block', reason: 'cost-ceiling' },
      redactedText: '',
      mutations: [],
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'snooze it', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('policy-gate:cost-ceiling');
  });

  it('denies an empty action verb', () => {
    const decision = decideAutoAuthorization('   ', 'rationale', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('empty action');
  });
});

describe('decideAutoAuthorization — FAIL-CLOSED on thrown gate errors (d)', () => {
  it('denies when checkInviolable throws', () => {
    mockedCheckInviolable.mockImplementation(() => {
      throw new Error('inviolable kernel exploded');
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'snooze', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('inviolable gate error (fail-closed)');
  });

  it('denies when runPolicyGate throws', () => {
    mockedRunPolicyGate.mockImplementation(() => {
      throw new Error('policy gate exploded');
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'snooze', tenantScope);
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('policy gate error (fail-closed)');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Additive continuous-autonomy overlay (frontier layer).
//
// The overlay runs ALONGSIDE the rails at the success point and may only
// ESCALATE. The kernel is still mocked default-safe (every rail passes),
// so these exercise the controller composition directly.
// ─────────────────────────────────────────────────────────────────────

describe('decideAutoAuthorization — additive autonomy overlay (e)', () => {
  it('a benign auto-safe verb authorizes with autonomyDecision=auto', () => {
    const decision = decideAutoAuthorization(
      'snooze_reminder',
      'low-stakes reminder snooze',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
    expect(decision.autonomyDecision).toBe('auto');
    expect(decision.autonomyReasons?.length ?? 0).toBeGreaterThan(0);
  });

  it('the controller ESCALATES a rail-allowed unknown verb to a gate', () => {
    // Unknown verb classifies as moderate/irreversible → controller gates
    // even though every rail passed. authorized flips to false.
    const decision = decideAutoAuthorization(
      'frobnicate_widget',
      'some rationale',
      tenantScope,
    );
    expect(decision.authorized).toBe(false);
    expect(decision.autonomyDecision).not.toBe('auto');
    expect(decision.reason).toContain('autonomy-controller:');
  });

  it('a low calibrated confidence escalates an otherwise-auto verb to gate', () => {
    const decision = decideAutoAuthorization(
      'snooze_reminder',
      'snooze',
      tenantScope,
      { calibratedConfidence: 0.1 },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.autonomyDecision).toBe('gate');
    expect(decision.autonomyGatedBy).toBe('confidence');
  });

  it('a situation flag escalates an otherwise-auto verb to four_eyes', () => {
    const decision = decideAutoAuthorization(
      'snooze_reminder',
      'snooze',
      tenantScope,
      { situationFlags: { defectionProbeHit: true } },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.autonomyDecision).toBe('four_eyes');
    expect(decision.autonomyGatedBy).toBe('situation');
  });

  it('a high-confidence caller-supplied operator posture keeps a safe verb auto', () => {
    const decision = decideAutoAuthorization(
      'snooze_reminder',
      'snooze',
      tenantScope,
      {
        calibratedConfidence: 0.99,
        mandate: 'operator',
        consequenceTier: 'low',
        reversibility: 'reversible',
      },
    );
    expect(decision.authorized).toBe(true);
    expect(decision.autonomyDecision).toBe('auto');
  });
});

describe('decideAutoAuthorization — INVARIANT: rail-gate always wins (f)', () => {
  it('HIGH-risk prefix → four_eyes overlay, never auto, before the kernel', () => {
    const decision = decideAutoAuthorization(
      'sovereign:transfer',
      // A maximally-confident operator context cannot relax the rail.
      'fully confident, do it',
      tenantScope,
      {
        calibratedConfidence: 1,
        mandate: 'operator',
        consequenceTier: 'trivial',
        reversibility: 'reversible',
      },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.autonomyDecision).toBe('four_eyes');
    // Rail short-circuits before the kernel even runs.
    expect(mockedRunPolicyGate).not.toHaveBeenCalled();
  });

  it('an inviolable block denies regardless of a permissive autonomy context', () => {
    mockedCheckInviolable.mockReturnValue({
      status: 'block',
      category: 'cross-tenant',
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'tidy', tenantScope, {
      calibratedConfidence: 1,
      mandate: 'operator',
    });
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('inviolable:cross-tenant');
  });

  it('a policy-gate block denies regardless of a permissive autonomy context', () => {
    mockedRunPolicyGate.mockReturnValue({
      verdict: { status: 'block', reason: 'cost-ceiling' },
      redactedText: '',
      mutations: [],
    });
    const decision = decideAutoAuthorization('snooze_reminder', 'snooze', tenantScope, {
      calibratedConfidence: 1,
      mandate: 'operator',
      consequenceTier: 'trivial',
      reversibility: 'reversible',
    });
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toBe('policy-gate:cost-ceiling');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Generative-fulfillment screen (self-evolving org).
//
// A brain-GENERATED verb the deterministic registry never enumerated must be
// able to DEFER to the brain's agentic turn — but ONLY after the HARD rails
// clear. screenGenerativeVerb permits the defer for the soft autonomy-overlay
// denial of an unknown verb, and NEVER for a HIGH-risk / inviolable / policy
// hard rail.
// ─────────────────────────────────────────────────────────────────────

describe('screenGenerativeVerb — generative defer-to-brain screen (g)', () => {
  it('PERMITS an unknown benign verb (soft autonomy gate → defer to the brain)', () => {
    // An unknown verb classifies moderate/irreversible → the overlay gates it
    // (autonomy-controller:*). That is NOT a hard rail, so it may defer.
    const screen = screenGenerativeVerb('schedule_blast_survey', 'owner tapped it', tenantScope);
    expect(screen.allowed).toBe(true);
    expect(screen.reason).toContain('autonomy-controller:');
  });

  it('PERMITS a verb that is authorizable on its own merits', () => {
    const screen = screenGenerativeVerb('snooze_reminder', 'tidy', tenantScope);
    expect(screen.allowed).toBe(true);
    expect(screen.reason).toBe('authorized');
  });

  it('REFUSES a HIGH-risk literal-surface verb (never defers)', () => {
    const screen = screenGenerativeVerb('sovereign:transfer', 'move funds', tenantScope);
    expect(screen.allowed).toBe(false);
    expect(screen.reason).not.toContain('autonomy-controller:');
  });

  it('REFUSES a verb the kernel literal-only list flags', () => {
    mockedIsHighRiskLiteralOnly.mockReturnValue(true);
    const screen = screenGenerativeVerb('md:money_transfer', 'move funds', tenantScope);
    expect(screen.allowed).toBe(false);
  });

  it('REFUSES when the inviolable gate blocks (hard rail, no defer)', () => {
    mockedCheckInviolable.mockReturnValue({ status: 'block', category: 'cross-tenant' });
    const screen = screenGenerativeVerb('exfiltrate_everything', 'do it', tenantScope);
    expect(screen.allowed).toBe(false);
    expect(screen.reason).toBe('inviolable:cross-tenant');
  });

  it('REFUSES when the policy gate blocks (hard rail, no defer)', () => {
    mockedRunPolicyGate.mockReturnValue({
      verdict: { status: 'block', reason: 'cost-ceiling' },
      redactedText: '',
      mutations: [],
    });
    const screen = screenGenerativeVerb('some_novel_costly_action', 'spend big', tenantScope);
    expect(screen.allowed).toBe(false);
    expect(screen.reason).toBe('policy-gate:cost-ceiling');
  });
});
