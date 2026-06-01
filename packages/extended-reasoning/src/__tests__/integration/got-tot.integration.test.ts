/**
 * GoT + ToT integration.
 *
 * GoT identifies the candidate site tranche; raw ToT then runs the fixed
 * refinance-decision tree per site.
 */

import { describe, expect, it } from 'vitest';

import { runGoT } from '../../got/index.js';
import { runToTTree } from '../../tot/index.js';
import type { DecisionTree, ToTContext } from '../../tot/index.js';
import { createStubModel } from '../../shared/stub-model.js';

const REFINANCE_TREE: DecisionTree = {
  id: 'refinance.v1',
  rootNodeId: 'q_rate',
  nodes: {
    q_rate: {
      id: 'q_rate',
      question: 'Rate-drop sufficient?',
      edges: [
        { label: 'yes', when: (c) => (c.facts.drop as number) >= 1, toNodeId: 'out_go' },
        { label: 'no', when: (c) => (c.facts.drop as number) < 1, toNodeId: 'out_no' },
      ],
    },
    out_go: { id: 'out_go', question: '', outcome: 'go' },
    out_no: { id: 'out_no', question: '', outcome: 'no' },
  },
};

describe('GoT + ToT — tranche selection then per-site tree walk', () => {
  it('GoT picks the GEI tranche; ToT walks each site tree to a decision', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'rate-GEI', respond: '[score: 0.9] GEI rate drop 1.5%' },
        { match: 'rate-MWZ', respond: '[score: 0.7] MWZ rate drop 0.4%' },
        { match: 'pick', respond: '[score: 0.95] GEI tranche' },
      ],
    });
    const got = await runGoT(
      {
        question: 'Which region tranche to refinance?',
        ops: [
          { kind: 'generate', id: 'gei', prompt: 'rate-GEI' },
          { kind: 'generate', id: 'mwz', prompt: 'rate-MWZ' },
          { kind: 'merge', id: 'merge', from: ['gei', 'mwz'], prompt: 'pick' },
        ],
      },
      stub.call,
    );
    expect(got.bestNodeId).toBe('merge');

    const siteCtx: ToTContext = { facts: { drop: 1.5 } };
    const totResult = runToTTree({ tree: REFINANCE_TREE, ctx: siteCtx });
    expect(totResult.outcome).toBe('go');
  });
});
