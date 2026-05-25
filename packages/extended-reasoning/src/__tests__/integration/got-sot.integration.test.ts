/**
 * GoT + SoT integration.
 *
 * Common BORJIE pattern: GoT computes the portfolio analysis offline
 * (cached server-side); SoT then renders the result to the owner's mobile
 * device with FMP-friendly streaming.
 */

import { describe, expect, it } from 'vitest';

import { runGoT } from '../../got/index.js';
import { runSoT } from '../../sot/index.js';
import type { ModelAdapter } from '../../shared/types.js';
import { createStubModel } from '../../shared/stub-model.js';

describe('GoT → SoT briefing flow', () => {
  it('produces a stitched briefing whose skeleton arrives before any point', async () => {
    const gotStub = createStubModel({
      rules: [
        { match: 'gather', respond: '[score: 0.8] gather facts' },
        { match: 'analyse', respond: '[score: 0.88] analysis' },
      ],
    });
    const got = await runGoT(
      {
        question: 'Q2 portfolio analysis',
        ops: [
          { kind: 'generate', id: 'facts', prompt: 'gather' },
          { kind: 'refine', id: 'analysis', from: 'facts', prompt: 'analyse' },
        ],
      },
      gotStub.call,
    );
    expect(got.bestNodeId).toBe('analysis');

    // Stage 2 — SoT renders the briefing
    const skeleton: ModelAdapter = async () =>
      JSON.stringify(['Revenue', 'Occupancy', 'Risks', 'Next 30 days']);
    const point: ModelAdapter = async (input) => `Detail: ${input.prompt.slice(-30)}`;
    let order: string[] = [];
    let virtualNow = 0;
    const result = await runSoT({
      question: 'render Q2 portfolio briefing',
      skeletonModel: skeleton,
      pointModel: point,
      branchTimeoutMs: 500,
      onEvent: (e) => order.push(e.kind),
      nowMs: () => virtualNow++,
    });
    expect(order[0]).toBe('skeleton-ready');
    expect(result.text.length).toBeGreaterThan(0);
  });
});
