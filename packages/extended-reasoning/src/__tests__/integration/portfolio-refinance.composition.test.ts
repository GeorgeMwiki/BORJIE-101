/**
 * End-to-end composition test for the portfolio-refinance decision —
 * the canonical BORJIE scenario that exercises all 5 deferred patterns
 * the L1 audit punted on:
 *
 *   1. GoT          — merge per-property finance into cross-portfolio view
 *   2. LATS         — 60-day execution plan (which to refinance first?)
 *   3. raw ToT      — fixed refinance-route decision tree
 *   4. PRM substrate — score each step + emit a training sample
 *   5. SoT          — mobile-friendly owner briefing (FMP < skeleton latency)
 */

import { describe, expect, it, vi } from 'vitest';

import { runGoT } from '../../got/index.js';
import { runLATS } from '../../lats/index.js';
import { runToTTree } from '../../tot/index.js';
import type { DecisionTree, ToTContext } from '../../tot/index.js';
import {
  emitPrmTrainingSample,
  scoreStepWithPRM,
} from '../../prm-substrate/index.js';
import type {
  PrmModel,
  PrmStep,
  PrmTrainingSample,
} from '../../prm-substrate/index.js';
import { runSoT } from '../../sot/index.js';
import type { ModelAdapter } from '../../shared/types.js';
import { createStubModel } from '../../shared/stub-model.js';
import type {
  ActionSpaceFn,
  LatsAction,
  RewardFn,
  TransitionFn,
} from '../../lats/index.js';

// Pre-built refinance decision tree used by the composition. Mirrors the
// shape of the existing `EVICTION_DECISION_TREE` etc. but local to this
// integration test so the composition stays self-contained.
const REFINANCE_TREE: DecisionTree = {
  id: 'refinance-route.v1',
  rootNodeId: 'q_rate_drop',
  nodes: {
    q_rate_drop: {
      id: 'q_rate_drop',
      question: 'Is the available BoT rate at least 1% below current loan rate?',
      edges: [
        { label: 'yes', when: (c) => c.facts.rate_drop_pct as number >= 1, toNodeId: 'q_breakeven' },
        { label: 'no', when: (c) => (c.facts.rate_drop_pct as number) < 1, toNodeId: 'out_skip' },
      ],
    },
    q_breakeven: {
      id: 'q_breakeven',
      question: 'Will the breakeven happen within 18 months?',
      edges: [
        {
          label: 'yes',
          when: (c) => (c.facts.breakeven_months as number) <= 18,
          toNodeId: 'q_jurisdiction',
        },
        {
          label: 'no',
          when: (c) => (c.facts.breakeven_months as number) > 18,
          toNodeId: 'out_defer',
        },
      ],
    },
    q_jurisdiction: {
      id: 'q_jurisdiction',
      question: 'Is the property in a refinance-friendly jurisdiction?',
      edges: [
        {
          label: 'TZ',
          when: (c) => (c.facts.jurisdiction as string).startsWith('TZ'),
          toNodeId: 'out_refinance_tz',
        },
        {
          label: 'KE',
          when: (c) => (c.facts.jurisdiction as string).startsWith('KE'),
          toNodeId: 'out_refinance_ke',
        },
      ],
    },
    out_skip: { id: 'out_skip', question: '', outcome: 'skip' },
    out_defer: { id: 'out_defer', question: '', outcome: 'defer' },
    out_refinance_tz: { id: 'out_refinance_tz', question: '', outcome: 'refinance-tz-path' },
    out_refinance_ke: { id: 'out_refinance_ke', question: '', outcome: 'refinance-ke-path' },
  },
};

describe('Portfolio-refinance composition — GoT ∘ LATS ∘ ToT ∘ PRM ∘ SoT', () => {
  it('produces a coherent refinance plan and emits a PRM training sample', async () => {
    // === Step 1: GoT — per-property → city merge → regulatory overlay ===
    const gotStub = createStubModel({
      rules: [
        { match: 'market-DSM', respond: '[score: 0.88] DSM BoT prime = 11.5%, vs current 13.0%' },
        { match: 'market-ARU', respond: '[score: 0.82] ARU BoT prime = 11.8%, vs current 12.1%' },
        { match: 'finance-DSM', respond: '[score: 0.90] 1.5% drop, breakeven 14mo' },
        { match: 'finance-ARU', respond: '[score: 0.76] 0.3% drop, marginal' },
        { match: 'merge-cities', respond: '[score: 0.93] DSM tranche dominates' },
        { match: 'regulatory', respond: '[score: 0.96] Within BoT cap; OK' },
      ],
    });
    const gotResult = await runGoT(
      {
        question: 'Across my 12 properties, which to refinance?',
        ops: [
          { kind: 'generate', id: 'mkt-DSM', prompt: 'market-DSM', labels: ['city:DSM'] },
          { kind: 'generate', id: 'mkt-ARU', prompt: 'market-ARU', labels: ['city:ARU'] },
          { kind: 'refine', id: 'fin-DSM', from: 'mkt-DSM', prompt: 'finance-DSM' },
          { kind: 'refine', id: 'fin-ARU', from: 'mkt-ARU', prompt: 'finance-ARU' },
          { kind: 'merge', id: 'cities', from: ['fin-DSM', 'fin-ARU'], prompt: 'merge-cities' },
          { kind: 'refine', id: 'overlay', from: 'cities', prompt: 'regulatory' },
        ],
      },
      gotStub.call,
    );
    expect(gotResult.bestNodeId).toBe('overlay');

    // === Step 2: raw ToT — decide refinance route for the top-tranche property ===
    const totCtx: ToTContext = {
      facts: {
        rate_drop_pct: 1.5,
        breakeven_months: 14,
        jurisdiction: 'TZ-DSM',
      },
    };
    const totResult = runToTTree({ tree: REFINANCE_TREE, ctx: totCtx });
    expect(totResult.outcome).toBe('refinance-tz-path');

    // === Step 3: LATS — sequence the 60-day refinance execution ===
    type LatsS = {
      readonly day: number;
      readonly applied: boolean;
      readonly approved: boolean;
      readonly closed: boolean;
    };
    const latsActions: ReadonlyArray<LatsAction> = [
      { kind: 'request-statements' },
      { kind: 'submit-application' },
      { kind: 'await-approval' },
      { kind: 'close' },
    ];
    const actionSpace: ActionSpaceFn = (s) => {
      const st = s as LatsS;
      if (st.closed) return [];
      return latsActions;
    };
    const transition: TransitionFn = (s, a) => {
      const st = s as LatsS;
      switch (a.kind) {
        case 'request-statements':
          return { ...st, day: st.day + 3 };
        case 'submit-application':
          return { ...st, applied: true, day: st.day + 5 };
        case 'await-approval':
          return st.applied
            ? { ...st, approved: true, day: st.day + 21 }
            : { ...st, day: st.day + 1 };
        case 'close':
          return st.approved
            ? { ...st, closed: true, day: st.day + 7 }
            : { ...st, day: st.day + 1 };
        default:
          return st;
      }
    };
    const reward: RewardFn = (s) => {
      const st = s as LatsS;
      if (st.closed && st.day <= 60) return 1.0;
      if (st.closed) return 0.5;
      return 0;
    };
    const latsResult = await runLATS({
      rootState: { day: 0, applied: false, approved: false, closed: false } satisfies LatsS,
      actionSpace,
      transition,
      rewardFn: reward,
      maxDepth: 4,
      maxSimulations: 60,
      seed: 1,
    });
    const kinds = latsResult.bestTrajectory.map((t) => t.action.kind);
    expect(kinds).toContain('submit-application');

    // === Step 4: PRM substrate — score each step + emit training sample ===
    const prmSteps: ReadonlyArray<PrmStep> = latsResult.bestTrajectory.map((t, i) => ({
      index: i,
      description: String(t.action.kind),
      context: { day: (t.state as LatsS).day },
    }));
    const prmModel: PrmModel = {
      modelId: 'prm-test-v0',
      score: async (step) => (step.description === 'await-approval' ? 0.55 : 0.85),
    };
    const onLowScore = vi.fn();
    const scoreResults = await Promise.all(
      prmSteps.map((s) =>
        scoreStepWithPRM({
          step: s,
          loader: async () => prmModel,
          warnBelow: 0.6,
          onLowScore,
          contextSteps: prmSteps,
        }),
      ),
    );
    expect(scoreResults.every((r) => r.kind === 'scored')).toBe(true);
    // `await-approval` step scored 0.55 < 0.6 → callback fires
    expect(onLowScore).toHaveBeenCalled();

    // Emit the training sample
    const captured: PrmTrainingSample[] = [];
    const sample = await emitPrmTrainingSample(
      {
        conversationId: 'integration_test_1',
        taskClass: 'portfolio-refinance',
        steps: prmSteps,
        outcome: 'success',
        rewardSignal: latsResult.bestTotalReward,
        metadata: { jurisdiction: 'TZ-DSM', tot_outcome: totResult.outcome },
      },
      async (s) => {
        captured.push(s);
      },
    );
    expect(captured).toHaveLength(1);
    expect(sample.taskClass).toBe('portfolio-refinance');

    // === Step 5: SoT — produce the mobile owner briefing ===
    const skeletonModel: ModelAdapter = async () =>
      JSON.stringify([
        'Refinance verdict',
        'Top properties',
        'Execution timeline',
        'Risk callouts',
        'What we need from you',
      ]);
    const pointModel: ModelAdapter = async (input) => `Content for ${input.prompt.slice(-60)}`;
    const synthesisModel: ModelAdapter = async () => 'Stitched mobile briefing.';
    let virtualNow = 0;
    const nowMs = (): number => {
      const t = virtualNow;
      // Each call advances 100ms — composite cost is 5 (max-parallel) ≈ 100ms
      // skeleton + 100ms point + 100ms synthesis = 300ms total, FMP = 100ms.
      virtualNow += 100;
      return t;
    };
    const sotResult = await runSoT({
      question: 'Owner briefing: portfolio refinance plan',
      skeletonModel,
      pointModel,
      synthesisModel,
      maxBranches: 5,
      branchTimeoutMs: 800,
      nowMs,
    });
    expect(sotResult.skeleton).toHaveLength(5);
    expect(sotResult.fmpMs).toBeLessThan(sotResult.totalMs);
  });
});
