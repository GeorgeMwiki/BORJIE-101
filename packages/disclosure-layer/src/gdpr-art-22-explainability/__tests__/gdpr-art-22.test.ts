import { describe, expect, it } from 'vitest';

import {
  type DecisionEvent,
  generateCounterfactual,
  renderCounterfactual,
} from '../index.js';

const baseDecision: DecisionEvent = {
  id: 'dec-2026-05-19-77a3b9',
  kind: 'rent_waiver',
  outcome: 'deny',
  policyInvoked: 'waive.late_fee',
  inputs: [
    {
      name: 'days_late',
      observedValue: '12',
      requiredThreshold: '<= 5',
      passed: false,
    },
    {
      name: 'tenant_standing',
      observedValue: 'late_4_of_6',
      requiredThreshold: 'good_standing',
      passed: false,
    },
    {
      name: 'prior_waivers_ytd',
      observedValue: '0',
      requiredThreshold: '0',
      passed: true,
    },
  ],
  timestamp: '2026-05-19T12:00:00Z',
  affectedPrincipalId: 'usr_juma',
};

describe('gdpr-art-22: generateCounterfactual', () => {
  it('returns a frozen Counterfactual', () => {
    const r = generateCounterfactual(baseDecision);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.recoursePath)).toBe(true);
  });

  it('emits one counterfactual clause per FAILED input', () => {
    const r = generateCounterfactual(baseDecision);
    expect(r.counterfactuals).toHaveLength(2);
    const names = r.counterfactuals.map((c) => c.inputName);
    expect(names).toContain('days_late');
    expect(names).toContain('tenant_standing');
  });

  it('does NOT emit counterfactuals for passing inputs', () => {
    const r = generateCounterfactual(baseDecision);
    const names = r.counterfactuals.map((c) => c.inputName);
    expect(names).not.toContain('prior_waivers_ytd');
  });

  it('hypothetical outcome is "approve" for denied decisions', () => {
    const r = generateCounterfactual(baseDecision);
    for (const cf of r.counterfactuals) {
      expect(cf.hypotheticalOutcome).toBe('approve');
    }
  });

  it('hypothetical value mirrors the user-facing required threshold', () => {
    const r = generateCounterfactual(baseDecision);
    const daysCf = r.counterfactuals.find((c) => c.inputName === 'days_late');
    expect(daysCf?.hypotheticalValue).toBe('<= 5');
  });

  it('decisionId is carried through for audit trace', () => {
    const r = generateCounterfactual(baseDecision);
    expect(r.decisionId).toBe('dec-2026-05-19-77a3b9');
  });

  it('canChangeRule is true on a denied decision', () => {
    const r = generateCounterfactual(baseDecision);
    expect(r.recoursePath.canChangeRule).toBe(true);
  });

  it('canChangeRule is false on an approved decision', () => {
    const r = generateCounterfactual({ ...baseDecision, outcome: 'approve' });
    expect(r.recoursePath.canChangeRule).toBe(false);
  });

  it('human summary text matches the decision kind', () => {
    const r = generateCounterfactual(baseDecision);
    expect(r.humanSummary).toMatch(/waive/);
  });

  it('preserves all observed inputs (tenant-data audit)', () => {
    const r = generateCounterfactual(baseDecision);
    expect(r.observed).toHaveLength(3);
  });
});

describe('gdpr-art-22: IP-safety properties', () => {
  it('never reveals model internals — no "claude", "gpt", "opus", "sonnet" in card', () => {
    const r = generateCounterfactual(baseDecision);
    const text = JSON.stringify(r).toLowerCase();
    expect(text).not.toContain('claude');
    expect(text).not.toContain('gpt-');
    expect(text).not.toContain('opus');
    expect(text).not.toContain('sonnet');
  });

  it('never reveals internal heuristic thresholds (uses USER-FACING policy values only)', () => {
    const r = generateCounterfactual(baseDecision);
    const text = JSON.stringify(r);
    // Only the user-facing policy threshold "<= 5" appears, not an internal
    // confidence p=0.927 style value.
    expect(text).not.toMatch(/p\s*=\s*0\.\d+/);
    expect(text).not.toMatch(/confidence\s*[:=]\s*0\.\d+/);
  });

  it('never references RAG / vector / corpus internals', () => {
    const r = generateCounterfactual(baseDecision);
    const text = JSON.stringify(r).toLowerCase();
    expect(text).not.toContain('rag');
    expect(text).not.toContain('vector');
    expect(text).not.toContain('corpus');
    expect(text).not.toContain('embedding');
  });
});

describe('gdpr-art-22: renderCounterfactual text output', () => {
  it('includes "Policy invoked" line', () => {
    const t = renderCounterfactual(generateCounterfactual(baseDecision));
    expect(t).toContain('Policy invoked');
    expect(t).toContain('waive.late_fee');
  });

  it('lists each input with PASS/FAIL marker', () => {
    const t = renderCounterfactual(generateCounterfactual(baseDecision));
    expect(t).toContain('[PASS]');
    expect(t).toContain('[FAIL]');
  });

  it('renders counterfactual clauses with "If X had been Y"', () => {
    const t = renderCounterfactual(generateCounterfactual(baseDecision));
    expect(t).toMatch(/If days_late had been/);
  });

  it('lists recourse options', () => {
    const t = renderCounterfactual(generateCounterfactual(baseDecision));
    expect(t).toContain('Override');
    expect(t).toContain('human review');
  });

  it('ends with audit id', () => {
    const t = renderCounterfactual(generateCounterfactual(baseDecision));
    expect(t).toMatch(/Audit ID:\s*dec-2026-05-19-77a3b9/);
  });
});
