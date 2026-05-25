import { describe, it, expect } from 'vitest';
import {
  dispatchMission,
  needsApproval,
  type ActionRuntimePort,
  type HitlGatewayPort,
  type StepDispatcherRepositoryPort,
} from '../step-dispatcher.js';
import type { AgencyMission, MissionStep } from '../types.js';
import {
  makeMission,
  makeStep,
  makeClock,
  TENANT_A,
  FROZEN_NOW_ISO,
} from './_fixtures.js';

// ─────────────────────────────────────────────────────────────────────────
// needsApproval — pure helper, exhaustive autonomy matrix.
// ─────────────────────────────────────────────────────────────────────────

describe('step-dispatcher — needsApproval', () => {
  it('HITL_HIGH requires approval on every step', () => {
    const mission = makeMission({ autonomyTier: 'HITL_HIGH' });
    for (const kind of ['plan', 'gather', 'execute', 'check', 'reflect'] as const) {
      expect(needsApproval(mission, makeStep({ stepKind: kind }))).toBe(true);
    }
  });

  it('HITL_MEDIUM requires approval on execute + check only', () => {
    const mission = makeMission({ autonomyTier: 'HITL_MEDIUM' });
    expect(needsApproval(mission, makeStep({ stepKind: 'execute' }))).toBe(true);
    expect(needsApproval(mission, makeStep({ stepKind: 'check' }))).toBe(true);
    expect(needsApproval(mission, makeStep({ stepKind: 'gather' }))).toBe(false);
    expect(needsApproval(mission, makeStep({ stepKind: 'plan' }))).toBe(false);
    expect(needsApproval(mission, makeStep({ stepKind: 'reflect' }))).toBe(false);
  });

  it('HITL_LOW requires approval only on execute + HIGH-risk missions', () => {
    const high = makeMission({ autonomyTier: 'HITL_LOW', riskTier: 'HIGH' });
    expect(needsApproval(high, makeStep({ stepKind: 'execute' }))).toBe(true);
    expect(needsApproval(high, makeStep({ stepKind: 'gather' }))).toBe(false);

    const med = makeMission({ autonomyTier: 'HITL_LOW', riskTier: 'MEDIUM' });
    expect(needsApproval(med, makeStep({ stepKind: 'execute' }))).toBe(false);
  });

  it('AUTONOMOUS still requires approval on SOVEREIGN-risk missions', () => {
    const sov = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'SOVEREIGN' });
    expect(needsApproval(sov, makeStep({ stepKind: 'execute' }))).toBe(true);

    const low = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' });
    expect(needsApproval(low, makeStep({ stepKind: 'execute' }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// dispatchMission — exercise the in-memory adapter.
// ─────────────────────────────────────────────────────────────────────────

function makeInMemoryRepository(initial: {
  mission: AgencyMission;
  steps: MissionStep[];
}): {
  repo: StepDispatcherRepositoryPort;
  state: { mission: AgencyMission; steps: MissionStep[] };
} {
  const state = {
    mission: { ...initial.mission },
    steps: initial.steps.map((s) => ({ ...s })),
  };

  const repo: StepDispatcherRepositoryPort = {
    async readMission(args) {
      if (state.mission.tenantId !== args.tenantId) return null;
      if (state.mission.id !== args.missionId) return null;
      return state.mission;
    },
    async readDueSteps(args) {
      if (state.mission.id !== args.missionId) return [];
      return state.steps.filter(
        (s) =>
          s.scheduledFor !== null &&
          s.scheduledFor <= args.today &&
          (s.status === 'pending' || s.status === 'in_progress'),
      );
    },
    async readAllSteps(args) {
      if (state.mission.id !== args.missionId) return [];
      return state.steps;
    },
    async markStarted(args) {
      state.steps = state.steps.map((s) =>
        s.id === args.stepId
          ? { ...s, status: 'in_progress', startedAt: args.startedAt, attempts: s.attempts + 1 }
          : s,
      );
    },
    async markFinished(args) {
      state.steps = state.steps.map((s) =>
        s.id === args.stepId
          ? {
              ...s,
              status: args.status,
              resultJsonb: args.resultJsonb,
              completedAt: args.completedAt,
            }
          : s,
      );
    },
    async incrementSpent(args) {
      state.mission = {
        ...state.mission,
        spentMinorUnits: state.mission.spentMinorUnits + args.addMinorUnits,
      };
    },
    async setMissionStatus(args) {
      state.mission = {
        ...state.mission,
        status: args.status,
        completedAt: args.completedAt,
      };
    },
  };

  return { repo, state };
}

describe('step-dispatcher — dispatchMission', () => {
  it('runs all due pending steps and completes the mission when every step finishes', async () => {
    const mission = makeMission({
      autonomyTier: 'AUTONOMOUS',
      riskTier: 'LOW',
      status: 'active',
    });
    const steps: MissionStep[] = [
      makeStep({ id: 'mst-1', ordinal: 0, stepKind: 'plan' }),
      makeStep({ id: 'mst-2', ordinal: 1, stepKind: 'execute' }),
    ];
    const { repo, state } = makeInMemoryRepository({ mission, steps });

    const actionRuntime: ActionRuntimePort = {
      async run({ step }) {
        return {
          status: 'completed',
          result: { stepId: step.id, ok: true },
          durationMs: 10,
          costMinorUnits: 5,
          errorMessage: null,
        };
      },
    };
    const hitl: HitlGatewayPort = { isApproved: async () => true };

    const report = await dispatchMission(
      { tenantId: TENANT_A, missionId: mission.id },
      {
        actionRuntime,
        hitl,
        repository: repo,
        clock: makeClock(),
      },
    );

    expect(report.dispatched).toHaveLength(2);
    expect(report.dispatched.every((d) => d.status === 'completed')).toBe(true);
    expect(report.missionFinished).toBe(true);
    expect(report.newMissionStatus).toBe('completed');
    expect(state.mission.status).toBe('completed');
    expect(state.mission.spentMinorUnits).toBe(10);
  });

  it('skips steps awaiting HITL approval (HITL_HIGH)', async () => {
    const mission = makeMission({ autonomyTier: 'HITL_HIGH', status: 'active' });
    const steps: MissionStep[] = [
      makeStep({ id: 'mst-1', ordinal: 0, stepKind: 'execute' }),
    ];
    const { repo } = makeInMemoryRepository({ mission, steps });
    const actionRuntime: ActionRuntimePort = {
      async run() {
        throw new Error('should never run');
      },
    };
    const hitl: HitlGatewayPort = { isApproved: async () => false };

    const report = await dispatchMission(
      { tenantId: TENANT_A, missionId: mission.id },
      { actionRuntime, hitl, repository: repo, clock: makeClock() },
    );
    expect(report.dispatched).toHaveLength(0);
    expect(report.skippedAwaitingApproval).toEqual(['mst-1']);
  });

  it('auto-activates a planning mission on first dispatch', async () => {
    const mission = makeMission({
      status: 'planning',
      autonomyTier: 'AUTONOMOUS',
      riskTier: 'LOW',
    });
    const steps: MissionStep[] = [
      makeStep({ id: 'mst-1', stepKind: 'plan' }),
    ];
    const { repo, state } = makeInMemoryRepository({ mission, steps });
    const actionRuntime: ActionRuntimePort = {
      async run() {
        return {
          status: 'completed',
          result: null,
          durationMs: 1,
          costMinorUnits: 0,
          errorMessage: null,
        };
      },
    };
    const hitl: HitlGatewayPort = { isApproved: async () => true };

    await dispatchMission(
      { tenantId: TENANT_A, missionId: mission.id },
      { actionRuntime, hitl, repository: repo, clock: makeClock() },
    );
    // Mission should have been activated then completed.
    expect(state.mission.status).toBe('completed');
  });

  it('captures runtime errors as a failed step result', async () => {
    const mission = makeMission({
      autonomyTier: 'AUTONOMOUS',
      riskTier: 'LOW',
      status: 'active',
    });
    const steps: MissionStep[] = [makeStep({ id: 'mst-1', stepKind: 'execute' })];
    const { repo } = makeInMemoryRepository({ mission, steps });

    const actionRuntime: ActionRuntimePort = {
      async run() {
        throw new Error('boom');
      },
    };
    const hitl: HitlGatewayPort = { isApproved: async () => true };

    const report = await dispatchMission(
      { tenantId: TENANT_A, missionId: mission.id },
      { actionRuntime, hitl, repository: repo, clock: makeClock() },
    );

    expect(report.dispatched).toHaveLength(1);
    expect(report.dispatched[0]!.status).toBe('failed');
    expect(report.dispatched[0]!.errorMessage).toBe('boom');
    expect(report.newMissionStatus).toBe('escalated');
  });

  it('returns a no-op when mission is not found', async () => {
    const repo: StepDispatcherRepositoryPort = {
      async readMission() { return null; },
      async readDueSteps() { return []; },
      async readAllSteps() { return []; },
      async markStarted() { /* noop */ },
      async markFinished() { /* noop */ },
      async incrementSpent() { /* noop */ },
      async setMissionStatus() { /* noop */ },
    };
    const report = await dispatchMission(
      { tenantId: TENANT_A, missionId: 'missing' },
      {
        actionRuntime: { async run() { throw new Error('x'); } },
        hitl: { isApproved: async () => true },
        repository: repo,
        clock: makeClock(),
      },
    );
    expect(report.dispatched).toEqual([]);
    expect(report.missionFinished).toBe(false);
  });

  it('does nothing when the mission is paused', async () => {
    const mission = makeMission({ status: 'paused', autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' });
    const steps = [makeStep({ stepKind: 'execute' })];
    const { repo } = makeInMemoryRepository({ mission, steps });
    const report = await dispatchMission(
      { tenantId: TENANT_A, missionId: mission.id },
      {
        actionRuntime: { async run() { throw new Error('not allowed'); } },
        hitl: { isApproved: async () => true },
        repository: repo,
        clock: makeClock(),
      },
    );
    void FROZEN_NOW_ISO;
    expect(report.dispatched).toEqual([]);
  });
});
