import { describe, expect, it } from 'vitest';

import { heuristicPrm } from '../prm/heuristic-prm.js';
import type {
  PrmContext,
  ReasoningState,
  ReasoningStep,
} from '../types.js';

const defaultContext: PrmContext = Object.freeze({
  tenantId: 't1',
  scopeKind: null,
  scopeId: null,
  autonomyTier: 1,
  killswitchActive: false,
  domainHints: Object.freeze({}),
});

const baseState: ReasoningState = Object.freeze({
  intentKind: 'file_royalty',
  steps: Object.freeze([]),
  observations: Object.freeze([]),
  depth: 0,
  terminal: false,
});

function makeStep(args: Record<string, unknown>): ReasoningStep {
  return Object.freeze({
    id: 's1',
    kind: 'tool_call' as const,
    toolName: 'submit_royalty',
    args: Object.freeze(args),
    rationale: 'unit-test',
  });
}

describe('heuristicPrm — cite_presence', () => {
  it('rewards explicit citations', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ citations: ['doc-1', 'doc-2'] }),
      context: defaultContext,
    });
    const cite = out.signals.find((s) => s.name === 'cite_presence');
    expect(cite?.score).toBe(1);
  });

  it('penalises uncited steps', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({}),
      context: defaultContext,
    });
    const cite = out.signals.find((s) => s.name === 'cite_presence');
    expect(cite?.score).toBe(0.3);
  });
});

describe('heuristicPrm — compliance_precondition', () => {
  it('hard-zeros on unsatisfied precondition', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({
        preconditions: ['licence_active'],
        preconditions_satisfied: false,
      }),
      context: defaultContext,
    });
    expect(out.score).toBe(0);
  });

  it('full credit when satisfied', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({
        preconditions: ['licence_active'],
        preconditions_satisfied: true,
        citations: ['licence-doc'],
      }),
      context: defaultContext,
    });
    const cp = out.signals.find((s) => s.name === 'compliance_precondition');
    expect(cp?.score).toBe(1);
  });
});

describe('heuristicPrm — math_check', () => {
  it('rewards balanced arithmetic', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ lhs: 100, rhs: 100, citations: ['c'] }),
      context: defaultContext,
    });
    const math = out.signals.find((s) => s.name === 'math_check');
    expect(math?.score).toBe(1);
  });

  it('hard-zeros on mismatch', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ lhs: 100, rhs: 101, citations: ['c'] }),
      context: defaultContext,
    });
    const math = out.signals.find((s) => s.name === 'math_check');
    expect(math?.score).toBe(0);
  });

  it('is neutral when no arithmetic claim is made', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ citations: ['c'] }),
      context: defaultContext,
    });
    const math = out.signals.find((s) => s.name === 'math_check');
    expect(math?.score).toBe(0.8);
  });
});

describe('heuristicPrm — schema_validity', () => {
  it('hard-zeros when downstream schema rejects', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ __schema_valid: false }),
      context: defaultContext,
    });
    expect(out.score).toBe(0);
  });
});

describe('heuristicPrm — policy_alignment', () => {
  it('zeroes everything when killswitch is active', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ citations: ['c'] }),
      context: Object.freeze({ ...defaultContext, killswitchActive: true }),
    });
    expect(out.score).toBe(0);
  });

  it('down-weights at higher autonomy tier', () => {
    const tier3 = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ citations: ['c'] }),
      context: Object.freeze({ ...defaultContext, autonomyTier: 3 as const }),
    });
    const policy = tier3.signals.find((s) => s.name === 'policy_alignment');
    expect(policy?.score).toBe(0.6);
  });
});

describe('heuristicPrm — aggregate properties', () => {
  it('returns 5 signals', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({}),
      context: defaultContext,
    });
    expect(out.signals).toHaveLength(5);
  });

  it('clamps the final score to [0, 1]', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({ citations: ['c'] }),
      context: defaultContext,
    });
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(1);
  });

  it('returns a frozen output', () => {
    const out = heuristicPrm({
      state: baseState,
      candidateStep: makeStep({}),
      context: defaultContext,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });
});
