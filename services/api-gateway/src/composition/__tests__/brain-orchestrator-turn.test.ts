/**
 * brain-orchestrator-turn tests — the route adapter that makes the orchestrator
 * main-loop the live /brain/turn + /mining/chat generator.
 *
 * Covers the two pure, safety-critical surfaces:
 *   1. `resolveBrainOrchestratorRoutingEnabled` — the flag contract that MUST
 *      mirror the kernel resolver (DEFAULT-ON; KERNEL_USE_ORCHESTRATOR=false
 *      hard-kill; BORJIE_ORCHESTRATOR_MAINLOOP=0|false|off soft-disable). A
 *      mismatch would route a turn to the orchestrator handler while the kernel
 *      runs legacy (or vice-versa).
 *   2. `mapDecisionToTurnPayload` — the pure BrainDecision → turn payload
 *      projection (answer / softened / refusal), including the four-eye-style
 *      held proposed-action on a refusal.
 */

import { describe, it, expect } from 'vitest';
import type { BrainDecision } from '@borjie/central-intelligence';
import { PERSONA_IDS } from '@borjie/ai-copilot';
import {
  deriveStakes,
  mapDecisionToTurnPayload,
  resolveAuthorizedPersonaId,
  resolveBrainOrchestratorRoutingEnabled,
} from '../brain-orchestrator-turn';

// Minimal fixtures — the mapper only reads kind / text / reason /
// provenance.latencyMs / gateThatRefused, so a cast keeps the test focused.
const answerDecision = {
  kind: 'answer',
  text: 'Here is your grounded answer.',
  citations: [],
  provenance: { latencyMs: 5 },
} as unknown as BrainDecision;

const softenedDecision = {
  kind: 'softened',
  text: 'A hedged answer.',
  hedge: 'low confidence',
  citations: [],
  provenance: { latencyMs: 7 },
} as unknown as BrainDecision;

const inviolableRefusal = {
  kind: 'refusal',
  reason: 'That action is blocked by an inviolable rule.',
  gateThatRefused: 'inviolable',
  provenance: { latencyMs: 3 },
} as unknown as BrainDecision;

const policyRefusal = {
  kind: 'refusal',
  reason: 'Policy requires four-eye approval.',
  gateThatRefused: 'policy',
  provenance: { latencyMs: 4 },
} as unknown as BrainDecision;

describe('resolveBrainOrchestratorRoutingEnabled (flag contract)', () => {
  it('defaults ON when no levers are set', () => {
    expect(resolveBrainOrchestratorRoutingEnabled({})).toBe(true);
  });

  it('hard-kills when KERNEL_USE_ORCHESTRATOR=false', () => {
    expect(
      resolveBrainOrchestratorRoutingEnabled({
        KERNEL_USE_ORCHESTRATOR: 'false',
      }),
    ).toBe(false);
  });

  it('soft-disables on BORJIE_ORCHESTRATOR_MAINLOOP=0|false|off', () => {
    for (const v of ['0', 'false', 'off', 'OFF', 'False']) {
      expect(
        resolveBrainOrchestratorRoutingEnabled({
          BORJIE_ORCHESTRATOR_MAINLOOP: v,
        }),
      ).toBe(false);
    }
  });

  it('stays ON for any other flag value (e.g. 1 / on)', () => {
    expect(
      resolveBrainOrchestratorRoutingEnabled({
        BORJIE_ORCHESTRATOR_MAINLOOP: '1',
      }),
    ).toBe(true);
    expect(
      resolveBrainOrchestratorRoutingEnabled({
        BORJIE_ORCHESTRATOR_MAINLOOP: 'on',
      }),
    ).toBe(true);
  });

  it('hard-kill wins over an enabling soft flag', () => {
    expect(
      resolveBrainOrchestratorRoutingEnabled({
        KERNEL_USE_ORCHESTRATOR: 'false',
        BORJIE_ORCHESTRATOR_MAINLOOP: '1',
      }),
    ).toBe(false);
  });
});

describe('mapDecisionToTurnPayload (BrainDecision → turn payload)', () => {
  const common = { threadId: 'thr-1', personaId: 'mr-mwikila-head' };

  it('maps an answer to a non-refused payload', () => {
    const p = mapDecisionToTurnPayload({ decision: answerDecision, ...common });
    expect(p.refused).toBe(false);
    expect(p.responseText).toBe('Here is your grounded answer.');
    expect(p.timeMs).toBe(5);
    expect(p.threadId).toBe('thr-1');
    expect(p.finalPersonaId).toBe('mr-mwikila-head');
  });

  it('maps a softened decision to a non-refused payload carrying its text', () => {
    const p = mapDecisionToTurnPayload({
      decision: softenedDecision,
      ...common,
    });
    expect(p.refused).toBe(false);
    expect(p.responseText).toBe('A hedged answer.');
  });

  it('maps an inviolable refusal to a held, review-required proposed action', () => {
    const p = mapDecisionToTurnPayload({
      decision: inviolableRefusal,
      ...common,
    });
    expect(p.refused).toBe(true);
    expect(p.refusalGate).toBe('inviolable');
    expect(p.proposedAction?.reviewRequired).toBe(true);
    expect(p.proposedAction?.executionHeld).toBe(true);
    expect(p.proposedAction?.riskLevel).toBe('critical');
  });

  it('maps a policy refusal to a high (not critical) risk held action', () => {
    const p = mapDecisionToTurnPayload({ decision: policyRefusal, ...common });
    expect(p.refused).toBe(true);
    expect(p.refusalGate).toBe('policy');
    expect(p.proposedAction?.riskLevel).toBe('high');
  });
});

describe('resolveAuthorizedPersonaId (client forcePersonaId cannot escalate)', () => {
  const DEFAULT = 'mr-mwikila-head';

  it('returns the fallback when no forcePersonaId is supplied', () => {
    expect(
      resolveAuthorizedPersonaId({
        roles: ['OWNER'],
        fallbackPersonaId: DEFAULT,
      }),
    ).toBe(DEFAULT);
  });

  it('IGNORES a management-tier force from a non-management caller (BFLA barrier)', () => {
    // A buyer / customer / role-less caller MUST NOT be able to bind the
    // owner-advisor (owner-scoped portfolio tools) via a client string.
    for (const roles of [[], ['CUSTOMER'], ['BUYER'], ['EMPLOYEE'], ['WORKER']]) {
      expect(
        resolveAuthorizedPersonaId({
          forcePersonaId: PERSONA_IDS.OWNER_ADVISOR,
          roles,
          fallbackPersonaId: DEFAULT,
        }),
      ).toBe(DEFAULT);
      expect(
        resolveAuthorizedPersonaId({
          forcePersonaId: PERSONA_IDS.ESTATE_MANAGER,
          roles,
          fallbackPersonaId: DEFAULT,
        }),
      ).toBe(DEFAULT);
      expect(
        resolveAuthorizedPersonaId({
          forcePersonaId: PERSONA_IDS.PRICE_NEGOTIATOR,
          roles,
          fallbackPersonaId: DEFAULT,
        }),
      ).toBe(DEFAULT);
    }
  });

  it('HONORS a management-tier force for a management-tier caller (legit owner still works)', () => {
    expect(
      resolveAuthorizedPersonaId({
        forcePersonaId: PERSONA_IDS.OWNER_ADVISOR,
        roles: ['OWNER'],
        fallbackPersonaId: DEFAULT,
      }),
    ).toBe(PERSONA_IDS.OWNER_ADVISOR);
    expect(
      resolveAuthorizedPersonaId({
        forcePersonaId: PERSONA_IDS.ESTATE_MANAGER,
        roles: ['MANAGER'],
        fallbackPersonaId: DEFAULT,
      }),
    ).toBe(PERSONA_IDS.ESTATE_MANAGER);
    // Case-insensitive role match — admin token vocabulary variations.
    expect(
      resolveAuthorizedPersonaId({
        forcePersonaId: PERSONA_IDS.OWNER_ADVISOR,
        roles: ['tenant_admin'],
        fallbackPersonaId: DEFAULT,
      }),
    ).toBe(PERSONA_IDS.OWNER_ADVISOR);
  });

  it('honors a baseline (non-management) force for any authenticated caller', () => {
    // The counterparty/customer assistant carries the baseline catalog — a
    // customer forcing it is not an escalation.
    expect(
      resolveAuthorizedPersonaId({
        forcePersonaId: PERSONA_IDS.TENANT_ASSISTANT,
        roles: ['CUSTOMER'],
        fallbackPersonaId: DEFAULT,
      }),
    ).toBe(PERSONA_IDS.TENANT_ASSISTANT);
  });
});

describe('deriveStakes (turn → kernel stakes)', () => {
  it('escalates licence / royalty / contract / succession / treasury turns to high', () => {
    expect(deriveStakes({ userText: 'Should I renew the PML licence?' })).toBe('high');
    expect(deriveStakes({ userText: 'Compute this month royalty / mrabaha owed.' })).toBe('high');
    expect(deriveStakes({ userText: 'Draft the offtake contract terms.' })).toBe('high');
    expect(deriveStakes({ userText: 'Plan the estate succession for my heirs.' })).toBe('high');
    expect(deriveStakes({ userText: 'Approve the treasury payout to the supplier.' })).toBe('high');
  });

  it('escalates kill-switch / licence-revocation language to critical', () => {
    expect(deriveStakes({ userText: 'Trigger the kill-switch now.' })).toBe('critical');
    expect(deriveStakes({ userText: 'Revoke licence PML-123 immediately.' })).toBe('critical');
  });

  it('classifies conversational / informational turns as low', () => {
    expect(deriveStakes({ userText: 'Hello there' })).toBe('low');
    expect(deriveStakes({ userText: 'What is the weather at the site?' })).toBe('low');
  });

  it('defaults unclassified turns to medium', () => {
    expect(deriveStakes({ userText: 'Move the truck to section 3.' })).toBe('medium');
    expect(deriveStakes({ userText: '' })).toBe('medium');
  });

  it('an explicit hint always overrides the derived value', () => {
    // "Hello" would derive low, but the CEO-mode hint forces high.
    expect(deriveStakes({ userText: 'Hello', hint: 'high' })).toBe('high');
    expect(deriveStakes({ userText: 'Revoke licence', hint: 'low' })).toBe('low');
  });
});
