/**
 * Cross-pattern integration tests — complement the main composition test
 * by exercising pairs of modules together. These catch contract drift
 * between modules without requiring the full portfolio scenario.
 */

import { describe, expect, it } from 'vitest';

import { runGoT } from '../../got/index.js';
import { runLATS } from '../../lats/index.js';
import { runToTTree, EVICTION_DECISION_TREE, TENANT_SCREENING_TREE } from '../../tot/index.js';
import {
  emitPrmTrainingSample,
  scoreStepWithPRM,
} from '../../prm-substrate/index.js';
import type { PrmStep, PrmTrainingSample } from '../../prm-substrate/index.js';
import { runSoT } from '../../sot/index.js';
import { createStubModel } from '../../shared/stub-model.js';
import type {
  ActionSpaceFn,
  LatsAction,
  RewardFn,
  TransitionFn,
} from '../../lats/index.js';

describe('cross-pattern integrations', () => {
  it('integration 1 — ToT eviction outcome feeds LATS action filter', async () => {
    // Decision: tree says `offer-mediation`. LATS over the next-90-days uses
    // that as the seed action and only explores follow-ups consistent with it.
    const totResult = runToTTree({
      tree: EVICTION_DECISION_TREE,
      ctx: {
        facts: {
          notice_served: false,
          tenant_in_arrears: true,
          mediation_opt_in: true,
          mediation_offered: false,
        },
      },
    });
    expect(totResult.outcome).toBe('offer-mediation');

    // LATS step: from the offer-mediation root, plan the follow-up sequence
    type S = {
      readonly day: number;
      readonly mediationResolved: boolean;
      readonly noticeServed: boolean;
    };
    const actionSpace: ActionSpaceFn = (s) => {
      const st = s as S;
      if (st.mediationResolved) return [];
      if (!st.noticeServed) return [{ kind: 'await-response' }, { kind: 'serve-notice' }];
      return [{ kind: 'await-response' }];
    };
    const transition: TransitionFn = (s, a) => {
      const st = s as S;
      if (a.kind === 'await-response') {
        return { ...st, day: st.day + 7, mediationResolved: st.day >= 21 };
      }
      return { ...st, noticeServed: true, day: st.day + 1 };
    };
    const reward: RewardFn = (s) => ((s as S).mediationResolved ? 1.0 : 0);
    const lats = await runLATS({
      rootState: { day: 0, mediationResolved: false, noticeServed: false } satisfies S,
      actionSpace,
      transition,
      rewardFn: reward,
      maxDepth: 5,
      maxSimulations: 80,
      seed: 11,
    });
    expect(lats.bestTrajectory.length).toBeGreaterThan(0);
  });

  it('integration 2 — screening ToT outcome emits PRM training sample', async () => {
    const totResult = runToTTree({
      tree: TENANT_SCREENING_TREE,
      ctx: {
        facts: {
          id_verified: true,
          past_eviction: false,
          employment_verified: true,
          income_to_rent_ratio: 4,
          reference_count: 3,
        },
      },
    });

    const steps: PrmStep[] = totResult.path.map((p, i) => ({
      index: i,
      description: p.question || 'leaf',
      context: { node: p.nodeId, ...(p.edgeLabel !== undefined ? { edge: p.edgeLabel } : {}) },
    }));
    const captured: PrmTrainingSample[] = [];
    await emitPrmTrainingSample(
      {
        conversationId: 'screen_1',
        taskClass: 'tenant-screening',
        steps,
        outcome: totResult.outcome === 'approve' ? 'success' : 'partial',
        rewardSignal: 0.9,
        metadata: { tree_id: TENANT_SCREENING_TREE.id, outcome: totResult.outcome },
      },
      async (s) => {
        captured.push(s);
      },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.steps.length).toBeGreaterThan(0);
  });

  it('integration 3 — GoT result flows through PRM scoring without a model', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'a', respond: '[score: 0.8] a' },
        { match: 'b', respond: '[score: 0.7] b' },
      ],
    });
    const got = await runGoT(
      {
        question: 'q',
        ops: [
          { kind: 'generate', id: 'x', prompt: 'a' },
          { kind: 'generate', id: 'y', prompt: 'b' },
        ],
      },
      stub.call,
    );
    const step: PrmStep = {
      index: 0,
      description: `best node: ${got.bestNodeId}`,
    };
    const score = await scoreStepWithPRM({
      step,
      loader: async () => null,
    });
    // No PRM loaded → unscored
    expect(score).toEqual({ kind: 'unscored', reason: 'no-model-loaded' });
  });

  it('integration 4 — SoT skeleton arrives before any point expansion completes (FMP marker)', async () => {
    const events: string[] = [];
    let virtualNow = 0;
    const nowMs = (): number => {
      const t = virtualNow;
      virtualNow += 50;
      return t;
    };
    await runSoT({
      question: 'fast skeleton, slow points',
      skeletonModel: async () => JSON.stringify(['p1', 'p2', 'p3']),
      pointModel: async () => 'x',
      synthesisModel: async () => 'done',
      branchTimeoutMs: 200,
      nowMs,
      onEvent: (e) => events.push(e.kind),
    });
    // The very first event must be the skeleton — that's the FMP marker.
    expect(events[0]).toBe('skeleton-ready');
    // The last event is the synthesis.
    expect(events[events.length - 1]).toBe('synthesis-ready');
    // At least one point-ready in between
    expect(events.filter((e) => e === 'point-ready').length).toBeGreaterThanOrEqual(3);
  });
});
