import { describe, it, expect } from 'vitest';
import {
  createCounterfactualSelfCheck,
  deterministicFloor,
  computeRiskScore,
  maxGateDecision,
  type CounterfactualCheckInput,
  type CounterfactualGateDecision,
} from '../counterfactual-self-check.js';
import type { ClaudeClient } from '../_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const PROCEED_CRITIQUE = {
  counterfactual: 'If the FX quote is stale, we sell at a marginally worse rate.',
  downside_if_wrong: 'A few percent of margin on a reversible stockpile decision.',
  recoverable: true,
  recommended_decision: 'proceed',
  probability_wrong: 0.1,
};

const baseInput = (
  over: Partial<CounterfactualCheckInput> = {},
): CounterfactualCheckInput => ({
  tenantId: 't1',
  origin_junior: 'fx-treasury-agent',
  action_id: 'act-1',
  action_summary: 'Sell 2kg gold stockpile at today FX rate',
  evidence_ids: ['fx-quote#2026-06-08'],
  key_assumption: 'The FX quote is current within 1 hour',
  reversibility: 'reversible',
  downside_severity: 'low',
  confidence: 0.9,
  flow_posture: 'auto',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────
// Deterministic floor — authoritative for the worst corner
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — deterministic floor', () => {
  it('ALWAYS escalates an irreversible action with high downside', () => {
    expect(
      deterministicFloor(
        baseInput({ reversibility: 'irreversible', downside_severity: 'high', confidence: 0.99 }),
      ),
    ).toBe('escalate');
  });

  it('ALWAYS escalates an irreversible action with severe downside even at max confidence', () => {
    expect(
      deterministicFloor(
        baseInput({ reversibility: 'irreversible', downside_severity: 'severe', confidence: 1 }),
      ),
    ).toBe('escalate');
  });

  it('escalates on empty evidence chain (acting blind)', () => {
    expect(
      deterministicFloor(baseInput({ evidence_ids: [], downside_severity: 'low' })),
    ).toBe('escalate');
  });

  it('escalates an irreversible action when calibrated confidence is low', () => {
    expect(
      deterministicFloor(
        baseInput({ reversibility: 'irreversible', downside_severity: 'moderate', confidence: 0.4 }),
      ),
    ).toBe('escalate');
  });

  it('escalates reversible-with-cost when downside is severe', () => {
    expect(
      deterministicFloor(
        baseInput({ reversibility: 'reversible-with-cost', downside_severity: 'severe' }),
      ),
    ).toBe('escalate');
  });

  it('revises reversible-with-cost with high (not severe) downside', () => {
    expect(
      deterministicFloor(
        baseInput({ reversibility: 'reversible-with-cost', downside_severity: 'high', confidence: 0.9 }),
      ),
    ).toBe('revise');
  });

  it('allows proceed for a fully reversible low-downside action', () => {
    expect(deterministicFloor(baseInput())).toBe('proceed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Composition — gating only ever increases (additive guarantee)
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — maxGateDecision (monotone gating)', () => {
  const order: CounterfactualGateDecision[] = ['proceed', 'revise', 'escalate'];
  for (const a of order) {
    for (const b of order) {
      it(`max(${a}, ${b}) returns the stronger`, () => {
        const result = maxGateDecision(a, b);
        const rank: Record<CounterfactualGateDecision, number> = { proceed: 0, revise: 1, escalate: 2 };
        expect(rank[result]).toBe(Math.max(rank[a], rank[b]));
      });
    }
  }

  it('rail GATE always wins — gate can never downgrade a rail escalate', () => {
    // Simulate a rail decision of escalate composed with a brain proceed.
    expect(maxGateDecision('escalate', 'proceed')).toBe('escalate');
  });
});

// ─────────────────────────────────────────────────────────────────────
// check() — brain composes ON TOP of the floor
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — check() composition', () => {
  it('the brain can RAISE the gate (escalate) on a reversible action', async () => {
    const gate = createCounterfactualSelfCheck({
      claude: claudeOf({
        counterfactual: 'If the buyer renegotiates after assay, the deal collapses.',
        downside_if_wrong: 'Lose the only committed buyer this quarter.',
        recoverable: false,
        recommended_decision: 'escalate',
        probability_wrong: 0.5,
      }),
    });
    const out = await gate.check(baseInput({ downside_severity: 'moderate' }));
    expect(out.gate_decision).toBe('escalate');
    expect(out.deterministic_escalation).toBe(false); // brain, not the floor
  });

  it('the brain CANNOT lower the gate below the deterministic floor', async () => {
    // Brain says proceed, but the action is irreversible+severe ⇒ floor escalates.
    const gate = createCounterfactualSelfCheck({ claude: claudeOf(PROCEED_CRITIQUE) });
    const out = await gate.check(
      baseInput({ reversibility: 'irreversible', downside_severity: 'severe', confidence: 0.99 }),
    );
    expect(out.gate_decision).toBe('escalate');
    expect(out.deterministic_escalation).toBe(true);
  });

  it('proceeds when both floor and brain agree it is safe', async () => {
    const gate = createCounterfactualSelfCheck({ claude: claudeOf(PROCEED_CRITIQUE) });
    const out = await gate.check(baseInput());
    expect(out.gate_decision).toBe('proceed');
    expect(out.recoverable).toBe(true);
    expect(out.band).toBe('low');
    expect(out.evidence_ids).toEqual(['fx-quote#2026-06-08']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Fail-closed — brain outage must never open the gate
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — fail-closed brain behaviour', () => {
  it('escalates when the brain throws (irreversible action)', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('brain down'); } };
    const gate = createCounterfactualSelfCheck({ claude });
    const out = await gate.check(
      baseInput({ reversibility: 'irreversible', downside_severity: 'high' }),
    );
    expect(out.gate_decision).toBe('escalate');
  });

  it('escalates when the brain returns malformed JSON', async () => {
    const claude: ClaudeClient = { async complete() { return { content: 'not json {' }; } };
    const gate = createCounterfactualSelfCheck({ claude });
    const out = await gate.check(baseInput({ downside_severity: 'moderate' }));
    // Floor allows proceed for reversible+moderate, but fail-closed brain
    // critique recommends escalate ⇒ composed escalate.
    expect(out.gate_decision).toBe('escalate');
  });

  it('does not crash on a reversible low-risk action when the brain is down', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('brain down'); } };
    const gate = createCounterfactualSelfCheck({ claude });
    const out = await gate.check(baseInput());
    // Even reversible: fail-closed critique is escalate, so it gates.
    expect(out.gate_decision).toBe('escalate');
    expect(out.risk_score).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Risk score / band
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — risk score', () => {
  it('scores an irreversible severe low-confidence action near the top', () => {
    const score = computeRiskScore(
      baseInput({ reversibility: 'irreversible', downside_severity: 'severe', confidence: 0.1 }),
      0.9,
    );
    expect(score).toBeGreaterThan(0.66);
  });

  it('scores a reversible low-downside high-confidence action low', () => {
    const score = computeRiskScore(baseInput(), 0.05);
    expect(score).toBeLessThan(0.33);
  });

  it('clamps to [0,1]', () => {
    const score = computeRiskScore(
      baseInput({ reversibility: 'irreversible', downside_severity: 'severe', confidence: 0 }),
      1,
    );
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Input validation (zod)
// ─────────────────────────────────────────────────────────────────────

describe('counterfactual-self-check — input validation', () => {
  it('rejects a missing key_assumption', async () => {
    const gate = createCounterfactualSelfCheck({ claude: claudeOf(PROCEED_CRITIQUE) });
    await expect(
      // @ts-expect-error — deliberately omit key_assumption
      gate.check({ ...baseInput(), key_assumption: undefined }),
    ).rejects.toThrow();
  });

  it('rejects confidence out of range', async () => {
    const gate = createCounterfactualSelfCheck({ claude: claudeOf(PROCEED_CRITIQUE) });
    await expect(gate.check(baseInput({ confidence: 1.5 }))).rejects.toThrow();
  });
});
