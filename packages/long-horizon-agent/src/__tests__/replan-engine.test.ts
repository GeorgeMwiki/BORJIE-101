import { describe, it, expect } from 'vitest';
import {
  handleDrift,
  canAutoApply,
  composeRecipe,
  plannedStepsToInsertSteps,
  type ReplanRepositoryPort,
} from '../replan-engine.js';
import type {
  AgencyMission,
  DriftSignal,
  MissionDriftEvent,
  MissionStep,
} from '../types.js';
import {
  makeMission,
  makeStep,
  makeIdGenerator,
  makeClock,
  TENANT_A,
  FROZEN_NOW_ISO,
} from './_fixtures.js';

// ─────────────────────────────────────────────────────────────────────────
// canAutoApply matrix
// ─────────────────────────────────────────────────────────────────────────

describe('replan-engine — canAutoApply', () => {
  it('refuses goal_shift unconditionally', () => {
    expect(canAutoApply(makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' }), 'goal_shift')).toBe(false);
  });

  it('refuses budget_overrun (assigner must intervene)', () => {
    expect(canAutoApply(makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' }), 'budget_overrun')).toBe(false);
  });

  it('AUTONOMOUS + LOW risk auto-applies step_replan + deadline_slip', () => {
    const m = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' });
    expect(canAutoApply(m, 'step_replan')).toBe(true);
    expect(canAutoApply(m, 'deadline_slip')).toBe(true);
    expect(canAutoApply(m, 'external_blocker')).toBe(true);
  });

  it('AUTONOMOUS + MEDIUM risk requires HITL', () => {
    const m = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'MEDIUM' });
    expect(canAutoApply(m, 'step_replan')).toBe(false);
  });

  it('HITL_LOW only auto-applies step_replan', () => {
    const m = makeMission({ autonomyTier: 'HITL_LOW', riskTier: 'LOW' });
    expect(canAutoApply(m, 'step_replan')).toBe(true);
    expect(canAutoApply(m, 'deadline_slip')).toBe(false);
  });

  it('HITL_HIGH + HITL_MEDIUM never auto-apply', () => {
    for (const tier of ['HITL_HIGH', 'HITL_MEDIUM'] as const) {
      const m = makeMission({ autonomyTier: tier, riskTier: 'LOW' });
      for (const k of ['step_replan', 'deadline_slip', 'external_blocker'] as const) {
        expect(canAutoApply(m, k)).toBe(false);
      }
    }
  });

  it('SOVEREIGN risk always requires HITL', () => {
    const m = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'SOVEREIGN' });
    expect(canAutoApply(m, 'step_replan')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// composeRecipe — pure recipe shapes
// ─────────────────────────────────────────────────────────────────────────

describe('replan-engine — composeRecipe', () => {
  it('step_replan inserts a reflect + plan pair before the stuck step', () => {
    const stuck = makeStep({ id: 'mst-stuck', ordinal: 2, attempts: 4 });
    const ids = makeIdGenerator();
    const recipe = composeRecipe({
      driftKind: 'step_replan',
      mission: makeMission(),
      steps: [stuck],
      signal: {
        kind: 'step_replan',
        message: 'stuck',
        observedAt: FROZEN_NOW_ISO,
        details: { stepId: 'mst-stuck' },
      },
      ids,
      nowIso: FROZEN_NOW_ISO,
    });
    expect(recipe.insertSteps).toHaveLength(2);
    expect(recipe.insertSteps[0]!.stepKind).toBe('reflect');
    expect(recipe.insertSteps[1]!.stepKind).toBe('plan');
    expect(recipe.skipStepIds).toEqual(['mst-stuck']);
  });

  it('step_replan emits empty recipe when stepId missing', () => {
    const recipe = composeRecipe({
      driftKind: 'step_replan',
      mission: makeMission(),
      steps: [],
      signal: {
        kind: 'step_replan',
        message: 'x',
        observedAt: FROZEN_NOW_ISO,
        details: {},
      },
      ids: makeIdGenerator(),
      nowIso: FROZEN_NOW_ISO,
    });
    expect(recipe.insertSteps).toEqual([]);
  });

  it('deadline_slip pushes date out by remaining pending steps', () => {
    const recipe = composeRecipe({
      driftKind: 'deadline_slip',
      mission: makeMission({ expectedCompletionDate: '2026-05-10' }),
      steps: [makeStep({ status: 'pending' }), makeStep({ id: 'mst-2', ordinal: 1, status: 'in_progress' })],
      signal: {
        kind: 'deadline_slip',
        message: 'late',
        observedAt: FROZEN_NOW_ISO,
        details: {},
      },
      ids: makeIdGenerator(),
      nowIso: '2026-05-22T00:00:00.000Z',
    });
    expect(recipe.newExpectedCompletionDate).toBe('2026-05-24');
  });

  it('external_blocker pauses the mission', () => {
    const recipe = composeRecipe({
      driftKind: 'external_blocker',
      mission: makeMission(),
      steps: [],
      signal: { kind: 'external_blocker', message: 'x', observedAt: FROZEN_NOW_ISO, details: {} },
      ids: makeIdGenerator(),
      nowIso: FROZEN_NOW_ISO,
    });
    expect(recipe.newStatus).toBe('paused');
  });

  it('budget_overrun + goal_shift return empty recipes', () => {
    for (const driftKind of ['budget_overrun', 'goal_shift'] as const) {
      const recipe = composeRecipe({
        driftKind,
        mission: makeMission(),
        steps: [],
        signal: { kind: driftKind, message: 'x', observedAt: FROZEN_NOW_ISO, details: {} },
        ids: makeIdGenerator(),
        nowIso: FROZEN_NOW_ISO,
      });
      expect(recipe.insertSteps).toEqual([]);
      expect(recipe.newStatus).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handleDrift — exercise auto-apply + HITL gating
// ─────────────────────────────────────────────────────────────────────────

function makeInMemoryRepo(initial: {
  mission: AgencyMission;
  steps: MissionStep[];
}): {
  repo: ReplanRepositoryPort;
  drifts: MissionDriftEvent[];
  applied: Array<{
    insertSteps: ReadonlyArray<Omit<MissionStep, 'createdAt'>>;
    skipStepIds: ReadonlyArray<string>;
    newDate: string | null;
    newStatus: string | null;
  }>;
} {
  const state = { mission: { ...initial.mission }, steps: [...initial.steps] };
  const drifts: MissionDriftEvent[] = [];
  const applied: Array<{
    insertSteps: ReadonlyArray<Omit<MissionStep, 'createdAt'>>;
    skipStepIds: ReadonlyArray<string>;
    newDate: string | null;
    newStatus: string | null;
  }> = [];
  const repo: ReplanRepositoryPort = {
    async readMission(args) {
      if (args.missionId !== state.mission.id) return null;
      return state.mission;
    },
    async readAllSteps() {
      return state.steps;
    },
    async applyReplan(args) {
      applied.push({
        insertSteps: args.insertSteps,
        skipStepIds: args.skipStepIds,
        newDate: args.newExpectedCompletionDate,
        newStatus: args.newStatus,
      });
    },
    async insertDriftEvent(event) {
      drifts.push({ ...event, createdAt: FROZEN_NOW_ISO });
    },
  };
  return { repo, drifts, applied };
}

describe('replan-engine — handleDrift', () => {
  it('auto-applies step_replan on AUTONOMOUS+LOW mission', async () => {
    const mission = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' });
    const steps = [makeStep({ id: 'mst-stuck', attempts: 5 })];
    const { repo, drifts, applied } = makeInMemoryRepo({ mission, steps });
    const ids = makeIdGenerator();
    const report = await handleDrift(
      {
        tenantId: TENANT_A,
        missionId: mission.id,
        signal: {
          kind: 'step_replan',
          message: 'stuck',
          observedAt: FROZEN_NOW_ISO,
          details: { stepId: 'mst-stuck' },
        },
      },
      { repository: repo, ids, clock: makeClock() },
    );
    expect(report.action).toBe('auto-applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.skipStepIds).toEqual(['mst-stuck']);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]!.driftKind).toBe('step_replan');
    expect(drifts[0]!.approvedAt).toBe(FROZEN_NOW_ISO);
  });

  it('queues for HITL on HITL_HIGH mission', async () => {
    const mission = makeMission({ autonomyTier: 'HITL_HIGH' });
    const { repo, drifts, applied } = makeInMemoryRepo({ mission, steps: [] });
    const ids = makeIdGenerator();
    const report = await handleDrift(
      {
        tenantId: TENANT_A,
        missionId: mission.id,
        signal: {
          kind: 'deadline_slip',
          message: 'late',
          observedAt: FROZEN_NOW_ISO,
          details: {},
        },
      },
      { repository: repo, ids, clock: makeClock() },
    );
    expect(report.action).toBe('queued-for-hitl');
    expect(applied).toEqual([]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]!.approvedAt).toBeNull();
  });

  it('forced approval bypasses tier check', async () => {
    const mission = makeMission({ autonomyTier: 'HITL_HIGH' });
    const stuck = makeStep({ id: 'mst-stuck', attempts: 3 });
    const { repo, applied } = makeInMemoryRepo({ mission, steps: [stuck] });
    const report = await handleDrift(
      {
        tenantId: TENANT_A,
        missionId: mission.id,
        signal: {
          kind: 'step_replan',
          message: 'stuck',
          observedAt: FROZEN_NOW_ISO,
          details: { stepId: 'mst-stuck' },
        },
        forceApprovedByUserId: 'usr-approver',
      },
      { repository: repo, ids: makeIdGenerator(), clock: makeClock() },
    );
    expect(report.action).toBe('auto-applied');
    expect(applied).toHaveLength(1);
  });

  it('returns no-op for unknown drift kind', async () => {
    const mission = makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' });
    const { repo } = makeInMemoryRepo({ mission, steps: [] });
    const signal: DriftSignal = {
      kind: 'something_new',
      message: 'unknown',
      observedAt: FROZEN_NOW_ISO,
      details: {},
    };
    const report = await handleDrift(
      { tenantId: TENANT_A, missionId: mission.id, signal },
      { repository: repo, ids: makeIdGenerator(), clock: makeClock() },
    );
    expect(report.action).toBe('no-op');
  });

  it('returns no-op when mission not found', async () => {
    const { repo } = makeInMemoryRepo({ mission: makeMission(), steps: [] });
    const report = await handleDrift(
      {
        tenantId: TENANT_A,
        missionId: 'missing',
        signal: { kind: 'step_replan', message: 'x', observedAt: FROZEN_NOW_ISO, details: {} },
      },
      { repository: repo, ids: makeIdGenerator(), clock: makeClock() },
    );
    expect(report.action).toBe('no-op');
  });
});

describe('replan-engine — plannedStepsToInsertSteps', () => {
  it('maps planned steps into insertable rows', () => {
    const out = plannedStepsToInsertSteps(
      [
        { ordinal: 0, title: 'A', description: null, stepKind: 'plan', actionPlanId: null, scheduledFor: null },
        { ordinal: 1, title: 'B', description: 'desc', stepKind: 'execute', actionPlanId: 'apl-1', scheduledFor: '2026-05-22' },
      ],
      { tenantId: TENANT_A, missionId: 'mis-1', ids: makeIdGenerator() },
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.status).toBe('pending');
    expect(out[1]!.actionPlanId).toBe('apl-1');
    expect(out[1]!.scheduledFor).toBe('2026-05-22');
  });
});
