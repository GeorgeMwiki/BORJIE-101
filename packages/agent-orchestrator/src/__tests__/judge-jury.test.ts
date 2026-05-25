import { describe, expect, it } from 'vitest';
import { createJudgePanel } from '../judge-jury/judge-panel.js';
import type { Judge, JudgeRubricCriterion, JudgeScore } from '../judge-jury/judge-panel.js';
import { runConstitutionalVerifier } from '../judge-jury/constitutional-verifier.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

function fixedJudge(id: string, accept: boolean, overall = 0.8): Judge {
  return {
    id,
    async evaluate({ rubric }) {
      const score: JudgeScore = {
        judgeId: id,
        criterionScores: rubric.map((r) => ({ key: r.key, score: overall, rationale: 'fixed' })),
        overall,
        accept,
        confidence: 0.9,
      };
      return score;
    },
  };
}

const rubric: ReadonlyArray<JudgeRubricCriterion> = [
  { key: 'clarity', description: 'is the answer clear?', weight: 1 },
  { key: 'truth',   description: 'is the answer factual?', weight: 1 },
];

describe('createJudgePanel', () => {
  it('returns majority verdict when 2/3 accept', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    const panel = createJudgePanel({
      brain,
      rubric,
      judges: [fixedJudge('j1', true), fixedJudge('j2', true), fixedJudge('j3', false)],
    });
    const verdict = await panel.verify('candidate');
    expect(verdict.accept).toBe(true);
    expect(verdict.ratio).toBeCloseTo(2 / 3);
    expect(verdict.breakdown).toHaveLength(3);
  });

  it('rejects when ratio falls below threshold', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    const panel = createJudgePanel({
      brain,
      rubric,
      judges: [fixedJudge('j1', true), fixedJudge('j2', false)],
      acceptanceThreshold: 0.75,
    });
    const v = await panel.verify('x');
    expect(v.accept).toBe(false);
  });

  it('throws when judges array empty', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    expect(() => createJudgePanel({ brain, rubric, judges: [] })).toThrow(/judges/);
  });
});

describe('runConstitutionalVerifier', () => {
  it('passes through when first verdict accepts', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    const panel = createJudgePanel({
      brain,
      rubric,
      judges: [fixedJudge('j1', true)],
    });
    const out = await runConstitutionalVerifier({
      agent: makeAgent(),
      brain,
      judges: panel,
      rubric,
      candidate: 'orig',
    });
    expect(out.accepted).toBe(true);
    expect(out.finalCandidate).toBe('orig');
    expect(out.passes).toHaveLength(1);
  });

  it('reattempts after critique then succeeds on revised draft', async () => {
    let firstJudgeCall = true;
    const flippingJudge: Judge = {
      id: 'flip',
      async evaluate({ rubric: r }) {
        const accept = !firstJudgeCall;
        firstJudgeCall = false;
        return {
          judgeId: 'flip',
          criterionScores: r.map((x) => ({ key: x.key, score: 0.9, rationale: '' })),
          overall: 0.9,
          accept,
          confidence: 1,
        };
      },
    };
    // Brain: first the critic JSON, then the revised draft.
    const { brain } = makeScriptedBrain({
      turns: [
        { text: JSON.stringify({ violations: [{ principle: 'clarity', evidence: 'unclear' }], summary: 'fix it' }), stopReason: 'end_turn' },
        { text: 'revised better draft', stopReason: 'end_turn' },
      ],
    });
    const panel = createJudgePanel({ brain, rubric, judges: [flippingJudge] });
    const out = await runConstitutionalVerifier({
      agent: makeAgent(),
      brain,
      judges: panel,
      rubric,
      candidate: 'original',
      maxPasses: 3,
    });
    expect(out.accepted).toBe(true);
    expect(out.finalCandidate).toBe('revised better draft');
    expect(out.passes.length).toBeGreaterThanOrEqual(2);
  });

  it('returns accepted=false after maxPasses exhausted', async () => {
    const stubborn = fixedJudge('s', false);
    const { brain } = makeScriptedBrain({
      turns: [
        { text: JSON.stringify({ violations: [{ principle: 'x', evidence: 'y' }], summary: 's' }), stopReason: 'end_turn' },
        { text: 'rev1', stopReason: 'end_turn' },
        { text: JSON.stringify({ violations: [{ principle: 'x', evidence: 'z' }], summary: 's2' }), stopReason: 'end_turn' },
        { text: 'rev2', stopReason: 'end_turn' },
      ],
    });
    const panel = createJudgePanel({ brain, rubric, judges: [stubborn] });
    const out = await runConstitutionalVerifier({
      agent: makeAgent(),
      brain,
      judges: panel,
      rubric,
      candidate: 'c0',
      maxPasses: 2,
    });
    expect(out.accepted).toBe(false);
    expect(out.passes).toHaveLength(2);
  });
});
