import { describe, expect, it } from 'vitest';
import { runLATS, stableStringify } from './lats-runner.js';
import type {
  ActionSpaceFn,
  LatsAction,
  RewardFn,
  ReflectionFn,
  TransitionFn,
} from './types.js';

describe('runLATS — Language Agent Tree Search over long-horizon flows', () => {
  it('rejects non-positive simulation/depth budgets', async () => {
    const ok = {
      rootState: { tag: 'start' },
      actionSpace: (() => []) as ActionSpaceFn,
      transition: ((s) => s) as TransitionFn,
      rewardFn: (() => 0) as RewardFn,
      maxDepth: 1,
      maxSimulations: 1,
    };
    await expect(runLATS({ ...ok, maxSimulations: 0 })).rejects.toThrow(/maxSimulations/);
    await expect(runLATS({ ...ok, maxDepth: 0 })).rejects.toThrow(/maxDepth/);
  });

  it('Scenario 1 — 60-day offtake renewal: send-early dominates wait', async () => {
    // State carries the remaining-days-until-renewal and an outcome counter.
    type S = { readonly day: number; readonly counterpartyHappy: number; readonly signed: boolean };

    const actions: ReadonlyArray<LatsAction> = [
      { kind: 'send-early-renewal' },
      { kind: 'wait-and-call' },
      { kind: 'offer-discount' },
      { kind: 'partial-renewal' },
      { kind: 'not-renew' },
    ];
    const actionSpace: ActionSpaceFn = (state) => {
      const s = state as S;
      if (s.signed) return [];
      return actions;
    };
    const transition: TransitionFn = (state, action) => {
      const s = state as S;
      const a = action.kind;
      if (a === 'send-early-renewal' && s.day < 30) {
        return { day: s.day + 7, counterpartyHappy: s.counterpartyHappy + 2, signed: true };
      }
      if (a === 'wait-and-call' && s.day < 50) {
        return { day: s.day + 14, counterpartyHappy: s.counterpartyHappy + 1, signed: false };
      }
      if (a === 'offer-discount') {
        return { day: s.day + 5, counterpartyHappy: s.counterpartyHappy + 1, signed: true };
      }
      if (a === 'partial-renewal') {
        return { day: s.day + 7, counterpartyHappy: s.counterpartyHappy, signed: true };
      }
      if (a === 'not-renew') {
        return { day: s.day + 1, counterpartyHappy: s.counterpartyHappy - 3, signed: true };
      }
      return { day: s.day + 1, counterpartyHappy: s.counterpartyHappy, signed: false };
    };
    const rewardFn: RewardFn = (state) => {
      const s = state as S;
      // Maximise counterparty happiness AND being signed. Penalty for not-renew.
      return s.signed ? 0.8 + s.counterpartyHappy * 0.05 : s.counterpartyHappy * 0.02;
    };

    const result = await runLATS({
      rootState: { day: 0, counterpartyHappy: 0, signed: false } satisfies S,
      actionSpace,
      transition,
      rewardFn,
      maxDepth: 6,
      maxSimulations: 200,
      seed: 42,
    });

    expect(result.simulationsRun).toBe(200);
    expect(result.bestTrajectory.length).toBeGreaterThan(0);
    const firstAction = result.bestTrajectory[0]?.action.kind;
    // With this reward shape, sending early dominates (signed=true earlier,
    // higher cumulative counterpartyHappy).
    expect(['send-early-renewal', 'offer-discount']).toContain(firstAction);
  });

  it('Scenario 2 — 30-day onboarding: respects sequence dependencies', async () => {
    type S = { readonly stage: 'kyc' | 'supply_agreement' | 'advance' | 'mobilisation' | 'done' };
    const allActions: Record<S['stage'], ReadonlyArray<LatsAction>> = {
      kyc: [{ kind: 'do-kyc' }],
      supply_agreement: [{ kind: 'sign-supply-agreement' }],
      advance: [{ kind: 'collect-advance' }],
      mobilisation: [{ kind: 'mobilise' }],
      done: [],
    };
    const next: Record<S['stage'], S['stage']> = {
      kyc: 'supply_agreement',
      supply_agreement: 'advance',
      advance: 'mobilisation',
      mobilisation: 'done',
      done: 'done',
    };
    const actionSpace: ActionSpaceFn = (state) => allActions[(state as S).stage];
    const transition: TransitionFn = (state) => {
      const s = state as S;
      return { stage: next[s.stage] };
    };
    const rewardFn: RewardFn = (state) => ((state as S).stage === 'done' ? 1.0 : 0.0);

    const result = await runLATS({
      rootState: { stage: 'kyc' } satisfies S,
      actionSpace,
      transition,
      rewardFn,
      maxDepth: 4,
      maxSimulations: 32,
      seed: 7,
    });

    const kinds = result.bestTrajectory.map((s) => s.action.kind);
    expect(kinds).toEqual(['do-kyc', 'sign-supply-agreement', 'collect-advance', 'mobilise']);
  });

  it('Scenario 3 — 90-day licence suspension: reflection prunes "filed-too-early" branch', async () => {
    type S = {
      readonly daysElapsed: number;
      readonly noticeServed: boolean;
      readonly commissionFiled: boolean;
    };
    const actions: ReadonlyArray<LatsAction> = [
      { kind: 'serve-notice' },
      { kind: 'wait' },
      { kind: 'file-commission' },
      { kind: 'enforce' },
    ];
    const actionSpace: ActionSpaceFn = (state) => {
      const s = state as S;
      if (s.daysElapsed >= 90 || s.commissionFiled) return [];
      return actions;
    };
    const transition: TransitionFn = (state, action) => {
      const s = state as S;
      switch (action.kind) {
        case 'serve-notice':
          return { ...s, noticeServed: true, daysElapsed: s.daysElapsed + 1 };
        case 'wait':
          return { ...s, daysElapsed: s.daysElapsed + 14 };
        case 'file-commission':
          return { ...s, commissionFiled: true, daysElapsed: s.daysElapsed + 7 };
        case 'enforce':
          return { ...s, daysElapsed: s.daysElapsed + 30 };
        default:
          return s;
      }
    };
    const rewardFn: RewardFn = (state) => {
      const s = state as S;
      // Commission-filed gets reward IF notice was served first; otherwise 0
      if (s.commissionFiled && s.noticeServed) return 0.9;
      if (s.commissionFiled && !s.noticeServed) return 0.0; // illegal
      return 0.05;
    };

    // Reflection: prune file-commission whenever notice has not yet been served
    const reflectionCallback: ReflectionFn = (state, action) => {
      const s = state as S;
      return action.kind === 'file-commission' && !s.noticeServed;
    };

    const result = await runLATS({
      rootState: { daysElapsed: 0, noticeServed: false, commissionFiled: false } satisfies S,
      actionSpace,
      transition,
      rewardFn,
      maxDepth: 5,
      maxSimulations: 100,
      seed: 9,
      reflectionCallback,
    });

    // First action must be serve-notice (file-commission pruned by reflection)
    expect(result.bestTrajectory[0]?.action.kind).toBe('serve-notice');
    expect(result.prunedBranches).toBeGreaterThan(0);
  });

  it('Scenario 4 — monthly TRA royalty cycle: deterministic given same seed', async () => {
    type S = { readonly step: number };
    const actions: ReadonlyArray<LatsAction> = [
      { kind: 'compute' },
      { kind: 'file' },
      { kind: 'settle' },
      { kind: 'reconcile' },
    ];
    const actionSpace: ActionSpaceFn = (state) =>
      (state as S).step < 4 ? actions : [];
    const transition: TransitionFn = (state) => ({ step: (state as S).step + 1 });
    const rewardFn: RewardFn = (state) => (state as S).step * 0.1;

    const r1 = await runLATS({
      rootState: { step: 0 } satisfies S,
      actionSpace,
      transition,
      rewardFn,
      maxDepth: 4,
      maxSimulations: 50,
      seed: 1234,
    });
    const r2 = await runLATS({
      rootState: { step: 0 } satisfies S,
      actionSpace,
      transition,
      rewardFn,
      maxDepth: 4,
      maxSimulations: 50,
      seed: 1234,
    });
    expect(r1.bestTrajectory.map((s) => s.action.kind)).toEqual(
      r2.bestTrajectory.map((s) => s.action.kind),
    );
  });

  it('stableStringify produces order-independent state signatures', () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });
});
