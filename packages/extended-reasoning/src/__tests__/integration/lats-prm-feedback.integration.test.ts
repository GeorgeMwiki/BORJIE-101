/**
 * LATS + PRM feedback loop integration.
 *
 * Demonstrates the drop-in scoring contract under the realistic flow:
 *   - LATS finds the best trajectory for a long-horizon plan
 *   - PRM scores each step (model loaded → scored; absent → unscored)
 *   - low-scoring steps are surfaced to a callback for human review
 *
 * Confirms `unscored` paths still cleanly compose with downstream emission.
 */

import { describe, expect, it, vi } from 'vitest';

import { runLATS } from '../../lats/index.js';
import type {
  ActionSpaceFn,
  LatsAction,
  RewardFn,
  TransitionFn,
} from '../../lats/index.js';
import {
  emitPrmTrainingSample,
  scoreStepWithPRM,
} from '../../prm-substrate/index.js';
import type { PrmModel, PrmStep } from '../../prm-substrate/index.js';

type S = { readonly step: number };
const actions: ReadonlyArray<LatsAction> = [
  { kind: 'discover' },
  { kind: 'plan' },
  { kind: 'execute' },
];

const actionSpace: ActionSpaceFn = (s) => ((s as S).step < 3 ? actions : []);
const transition: TransitionFn = (s) => ({ step: (s as S).step + 1 });
const reward: RewardFn = (s) => (s as S).step / 3;

describe('LATS + PRM feedback loop', () => {
  it('scores all steps and emits a sample when a PRM is loaded', async () => {
    const lats = await runLATS({
      rootState: { step: 0 } satisfies S,
      actionSpace,
      transition,
      rewardFn: reward,
      maxDepth: 3,
      maxSimulations: 30,
      seed: 42,
    });
    expect(lats.bestTrajectory.length).toBeGreaterThan(0);

    const prmModel: PrmModel = {
      modelId: 'prm-v0.2',
      score: async (step) => (step.description === 'plan' ? 0.35 : 0.85),
    };
    const steps: ReadonlyArray<PrmStep> = lats.bestTrajectory.map((t, i) => ({
      index: i,
      description: String(t.action.kind),
    }));
    const onLowScore = vi.fn();
    const scored = await Promise.all(
      steps.map((s) =>
        scoreStepWithPRM({
          step: s,
          loader: async () => prmModel,
          warnBelow: 0.5,
          onLowScore,
        }),
      ),
    );
    expect(scored.every((s) => s.kind === 'scored')).toBe(true);

    const captures: unknown[] = [];
    await emitPrmTrainingSample(
      {
        conversationId: 'lats_prm_1',
        taskClass: 'discover-plan-execute',
        steps,
        outcome: 'success',
        rewardSignal: lats.bestTotalReward,
      },
      async (s) => {
        captures.push(s);
      },
    );
    expect(captures).toHaveLength(1);
  });

  it('degrades to unscored across all steps when PRM is absent — emission still works', async () => {
    const lats = await runLATS({
      rootState: { step: 0 } satisfies S,
      actionSpace,
      transition,
      rewardFn: reward,
      maxDepth: 3,
      maxSimulations: 30,
      seed: 99,
    });
    const onLowScore = vi.fn();
    const steps: ReadonlyArray<PrmStep> = lats.bestTrajectory.map((t, i) => ({
      index: i,
      description: String(t.action.kind),
    }));
    const scored = await Promise.all(
      steps.map((s) =>
        scoreStepWithPRM({
          step: s,
          loader: async () => null,
          warnBelow: 0.9,
          onLowScore,
        }),
      ),
    );
    expect(scored.every((s) => s.kind === 'unscored')).toBe(true);
    expect(onLowScore).not.toHaveBeenCalled();

    // Emission proceeds even with unscored results — the substrate decouples
    // training-data collection from scoring availability.
    const captures: unknown[] = [];
    await emitPrmTrainingSample(
      {
        conversationId: 'lats_prm_2',
        taskClass: 'discover-plan-execute',
        steps,
        outcome: 'partial',
        rewardSignal: lats.bestTotalReward,
      },
      async (s) => {
        captures.push(s);
      },
    );
    expect(captures).toHaveLength(1);
  });
});
