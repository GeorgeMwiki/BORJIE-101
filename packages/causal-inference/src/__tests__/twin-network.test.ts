import { describe, expect, it } from 'vitest';
import {
  twinNetworkCounterfactual,
  type StructuralCausalModel,
} from '../counterfactual/twin-network.js';
import { CausalInferenceError, type CausalGraph } from '../types.js';

describe('Twin-network counterfactual reasoning', () => {
  it('answers "what would Y have been if X had been set to x*" on a linear SCM', () => {
    // Linear SCM:
    //   Z = U_Z
    //   X = 2*Z + U_X
    //   Y = 3*X + U_Y
    //
    // Observed: Z=1, X=2.5, Y=7.7 -> noises U_Z=1, U_X=0.5, U_Y=0.2.
    // Counterfactual: do(X = 5).
    // Y_cf = 3*5 + 0.2 = 15.2.
    const graph: CausalGraph = {
      nodes: ['Z', 'X', 'Y'],
      edges: [
        { from: 'Z', to: 'X' },
        { from: 'X', to: 'Y' },
      ],
    };
    const scm: StructuralCausalModel = {
      graph,
      equations: [
        {
          variable: 'Z',
          parents: [],
          assign: (_pv, u) => u,
        },
        {
          variable: 'X',
          parents: ['Z'],
          assign: (pv, u) => 2 * (pv['Z'] as number) + u,
        },
        {
          variable: 'Y',
          parents: ['X'],
          assign: (pv, u) => 3 * (pv['X'] as number) + u,
        },
      ],
    };
    const result = twinNetworkCounterfactual(scm, {
      question: 'what if X had been 5?',
      observed: { Z: 1, X: 2.5, Y: 7.7 },
      intervention: { X: 5 },
      outcome: 'Y',
    });
    expect(result.factualOutcome).toBeCloseTo(7.7, 9);
    expect(result.counterfactualOutcome).toBeCloseTo(15.2, 9);
  });

  it('does not propagate the intervention through ancestors (Z stays 1)', () => {
    const graph: CausalGraph = {
      nodes: ['Z', 'X', 'Y'],
      edges: [
        { from: 'Z', to: 'X' },
        { from: 'X', to: 'Y' },
      ],
    };
    const scm: StructuralCausalModel = {
      graph,
      equations: [
        {
          variable: 'Z',
          parents: [],
          assign: (_pv, u) => u,
        },
        {
          variable: 'X',
          parents: ['Z'],
          assign: (pv) => pv['Z'] as number,
        },
        {
          variable: 'Y',
          parents: ['X', 'Z'],
          assign: (pv) => (pv['X'] as number) + (pv['Z'] as number),
        },
      ],
    };
    const r = twinNetworkCounterfactual(scm, {
      question: 'what if X had been 10?',
      observed: { Z: 3, X: 3, Y: 6 },
      intervention: { X: 10 },
      outcome: 'Y',
    });
    // Z remains 3; Y_cf = 10 + 3 = 13.
    expect(r.counterfactualOutcome).toBeCloseTo(13, 9);
  });

  it('throws CYCLE_DETECTED on a cyclic SCM', () => {
    const graph: CausalGraph = {
      nodes: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    const scm: StructuralCausalModel = {
      graph,
      equations: [
        { variable: 'a', parents: ['b'], assign: (pv) => pv['b'] as number },
        { variable: 'b', parents: ['a'], assign: (pv) => pv['a'] as number },
      ],
    };
    expect(() =>
      twinNetworkCounterfactual(scm, {
        question: 'cycle',
        observed: { a: 0, b: 0 },
        intervention: { a: 1 },
        outcome: 'b',
      }),
    ).toThrow(CausalInferenceError);
  });

  it('throws UNKNOWN_NODE when outcome is not in graph', () => {
    const scm: StructuralCausalModel = {
      graph: { nodes: ['x'], edges: [] },
      equations: [{ variable: 'x', parents: [], assign: (_pv, u) => u }],
    };
    expect(() =>
      twinNetworkCounterfactual(scm, {
        question: 'q',
        observed: { x: 1 },
        intervention: { x: 2 },
        outcome: 'absent',
      }),
    ).toThrow(CausalInferenceError);
  });
});
