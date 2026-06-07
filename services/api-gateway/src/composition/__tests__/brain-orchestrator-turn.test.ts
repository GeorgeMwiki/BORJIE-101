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
import {
  mapDecisionToTurnPayload,
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
