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
import { decideAutoAuthorization } from './index.js';
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
