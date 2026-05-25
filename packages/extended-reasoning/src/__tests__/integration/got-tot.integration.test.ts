/**
 * GoT + ToT integration.
 *
 * GoT identifies the candidate property tranche; raw ToT then runs the fixed
 * refinance-decision tree per property.
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

describe('GoT + ToT — tranche selection then per-property tree walk', () => {
  it('GoT picks the DSM tranche; ToT walks each property tree to a decision', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'rate-DSM', respond: '[score: 0.9] DSM rate drop 1.5%' },
        { match: 'rate-ARU', respond: '[score: 0.7] ARU rate drop 0.4%' },
        { match: 'pick', respond: '[score: 0.95] DSM tranche' },
      ],
    });
    const got = await runGoT(
      {
        question: 'Which city tranche to refinance?',
        ops: [
          { kind: 'generate', id: 'dsm', prompt: 'rate-DSM' },
          { kind: 'generate', id: 'aru', prompt: 'rate-ARU' },
          { kind: 'merge', id: 'merge', from: ['dsm', 'aru'], prompt: 'pick' },
        ],
      },
      stub.call,
    );
    expect(got.bestNodeId).toBe('merge');

    const propertyCtx: ToTContext = { facts: { drop: 1.5 } };
    const totResult = runToTTree({ tree: REFINANCE_TREE, ctx: propertyCtx });
    expect(totResult.outcome).toBe('go');
  });
});
