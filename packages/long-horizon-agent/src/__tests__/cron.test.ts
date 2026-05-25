import { describe, it, expect } from 'vitest';
import { runDailyAgencyCycle } from '../cron.js';
import { planMission } from '../mission-planner.js';
import type { CronRepositoryPort } from '../cron.js';
import type { CheckpointRepositoryPort } from '../checkpoint-runner.js';
import type { StepDispatcherRepositoryPort } from '../step-dispatcher.js';
import type { ReplanRepositoryPort } from '../replan-engine.js';
import type {
  OutcomeRepositoryPort,
  OutcomeNarratorPort,
  ReflexionFeedPort,
} from '../outcome-writer.js';
import type {
  AgencyMission,
  DriftSignal,
  MissionCheckpoint,
  MissionDriftEvent,
  MissionOutcome,
  MissionStep,
} from '../types.js';
import {
  makeClock,
  makeIdGenerator,
  TENANT_A,
  USER_A,
  FROZEN_NOW_ISO,
  FROZEN_TODAY,
} from './_fixtures.js';

// ─────────────────────────────────────────────────────────────────────────
// In-memory tenant-scoped store implementing every adapter port.
// Used for the end-to-end lifecycle + autonomy tests.
// ─────────────────────────────────────────────────────────────────────────

interface Store {
  missions: AgencyMission[];
  steps: MissionStep[];
  checkpoints: MissionCheckpoint[];
  drifts: MissionDriftEvent[];
  outcomes: MissionOutcome[];
}

function buildStore(): Store {
  return {
    missions: [],
    steps: [],
    checkpoints: [],
    drifts: [],
    outcomes: [],
  };
}

function makePorts(store: Store, opts: {
  freshDriftSignals?: ReadonlyArray<DriftSignal>;
}) {
  const checkpointRepo: CheckpointRepositoryPort = {
    async readMission(args) {
      return store.missions.find((m) => m.id === args.missionId) ?? null;
    },
    async readAllSteps(args) {
      return store.steps.filter((s) => s.missionId === args.missionId);
    },
    async readDueCheckpoints(args) {
      return store.checkpoints.filter(
        (c) =>
          c.tenantId === args.tenantId &&
          c.status === 'pending' &&
          c.scheduledAt <= args.nowIso,
      );
    },
    async markCheckpointCompleted(args) {
      store.checkpoints = store.checkpoints.map((c) =>
        c.id === args.checkpointId
          ? {
              ...c,
              status: 'completed',
              summary: args.summary,
              gapsJsonb: [...args.gaps],
              driftSignalsJsonb: [...args.driftSignals],
              needsHumanReview: args.needsHumanReview,
            }
          : c,
      );
    },
  };

  const stepRepo: StepDispatcherRepositoryPort = {
    async readMission(args) {
      return store.missions.find((m) => m.id === args.missionId) ?? null;
    },
    async readDueSteps(args) {
      return store.steps.filter(
        (s) =>
          s.missionId === args.missionId &&
          s.scheduledFor !== null &&
          s.scheduledFor <= args.today &&
          (s.status === 'pending' || s.status === 'in_progress'),
      );
    },
    async readAllSteps(args) {
      return store.steps.filter((s) => s.missionId === args.missionId);
    },
    async markStarted(args) {
      store.steps = store.steps.map((s) =>
        s.id === args.stepId
          ? {
              ...s,
              status: 'in_progress',
              startedAt: args.startedAt,
              attempts: s.attempts + 1,
            }
          : s,
      );
    },
    async markFinished(args) {
      store.steps = store.steps.map((s) =>
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
      store.missions = store.missions.map((m) =>
        m.id === args.missionId
          ? { ...m, spentMinorUnits: m.spentMinorUnits + args.addMinorUnits }
          : m,
      );
    },
    async setMissionStatus(args) {
      store.missions = store.missions.map((m) =>
        m.id === args.missionId
          ? { ...m, status: args.status, completedAt: args.completedAt }
          : m,
      );
    },
  };

  const replanRepo: ReplanRepositoryPort = {
    async readMission(args) {
      return store.missions.find((m) => m.id === args.missionId) ?? null;
    },
    async readAllSteps(args) {
      return store.steps.filter((s) => s.missionId === args.missionId);
    },
    async applyReplan(args) {
      store.steps = store.steps.map((s) =>
        args.skipStepIds.includes(s.id) ? { ...s, status: 'skipped' } : s,
      );
      for (const ins of args.insertSteps) {
        store.steps.push({ ...ins, createdAt: FROZEN_NOW_ISO });
      }
      if (args.newExpectedCompletionDate !== null) {
        store.missions = store.missions.map((m) =>
          m.id === args.missionId
            ? { ...m, expectedCompletionDate: args.newExpectedCompletionDate }
            : m,
        );
      }
      if (args.newStatus !== null) {
        store.missions = store.missions.map((m) =>
          m.id === args.missionId ? { ...m, status: args.newStatus! } : m,
        );
      }
    },
    async insertDriftEvent(event) {
      store.drifts.push({ ...event, createdAt: FROZEN_NOW_ISO });
    },
  };

  const outcomeRepo: OutcomeRepositoryPort = {
    async readMission(args) {
      return store.missions.find((m) => m.id === args.missionId) ?? null;
    },
    async readAllSteps(args) {
      return store.steps.filter((s) => s.missionId === args.missionId);
    },
    async readAllDrifts(args) {
      return store.drifts.filter((d) => d.missionId === args.missionId);
    },
    async insertOutcome(o) {
      const existing = store.outcomes.find((x) => x.missionId === o.missionId);
      if (existing) return existing;
      const persisted: MissionOutcome = { ...o, createdAt: FROZEN_NOW_ISO };
      store.outcomes.push(persisted);
      return persisted;
    },
  };

  const cronRepo: CronRepositoryPort = {
    async readActiveMissions(args) {
      return store.missions
        .filter(
          (m) =>
            m.tenantId === args.tenantId &&
            (m.status === 'active' || m.status === 'planning' || m.status === 'paused'),
        )
        .slice(0, args.limit);
    },
    async readFreshDriftSignals(args) {
      const cps = store.checkpoints.filter((c) =>
        args.checkpointIds.includes(c.id),
      );
      return cps.map((c) => ({
        checkpoint: c,
        signals: opts.freshDriftSignals ?? [],
      }));
    },
  };

  const narrator: OutcomeNarratorPort = {
    narrate: async ({ outcomeKind, metrics }) =>
      `outcome=${outcomeKind}; steps_completed=${metrics.stepsCompleted}`,
  };

  const reflexion: ReflexionFeedPort = {
    record: async () => ({ id: 'refl-1' }),
  };

  const ids = makeIdGenerator();
  const clock = makeClock();

  return {
    checkpointRunner: {
      summariser: {
        summarise: async ({ checkpoint }) => `Summary ${checkpoint.id}`,
      },
      briefWriter: {
        writeBrief: async () => ({ briefId: 'brf-1' }),
      },
      repository: checkpointRepo,
      clock,
    },
    stepDispatcher: {
      actionRuntime: {
        async run({ step }) {
          return {
            status: 'completed' as const,
            result: { ok: true, stepId: step.id },
            durationMs: 1,
            costMinorUnits: 1,
            errorMessage: null,
          };
        },
      },
      hitl: { isApproved: async () => true },
      repository: stepRepo,
      clock,
    },
    replanEngine: {
      repository: replanRepo,
      ids,
      clock,
    },
    outcomeWriter: {
      narrator,
      repository: outcomeRepo,
      reflexion,
      ids,
      clock,
    },
    cronRepository: cronRepo,
  };
}

describe('cron — runDailyAgencyCycle', () => {
  it('plans → dispatches → completes a mission with autonomy_tier=AUTONOMOUS', async () => {
    const store = buildStore();
    const ids = makeIdGenerator();

    // First, plan a mission inline using the planner (no HITL on
    // AUTONOMOUS+LOW).
    await planMission(
      {
        tenantId: TENANT_A,
        assignedByUserId: USER_A,
        ownerPersonaId: null,
        title: 'Find lessee for Plot 27B',
        goal: 'Sign a lessee on Plot 27B',
        context: { parcelId: 'parc-001' },
        constraints: {
          expectedCompletionDate: '2099-12-31',
          riskTier: 'LOW',
          autonomyTier: 'AUTONOMOUS',
          budgetMinorUnits: 1_000_000,
          assetRefs: ['parc-001'],
        },
      },
      {
        planner: {
          decompose: async () => [
            { ordinal: 0, title: 'Plan', description: null, stepKind: 'plan', actionPlanId: null, scheduledFor: FROZEN_TODAY },
            { ordinal: 1, title: 'Execute', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: FROZEN_TODAY },
            { ordinal: 2, title: 'Reflect', description: null, stepKind: 'reflect', actionPlanId: null, scheduledFor: FROZEN_TODAY },
          ],
        },
        repository: {
          async createMission(args) {
            const mission: AgencyMission = {
              ...args.mission,
              createdAt: FROZEN_NOW_ISO,
              updatedAt: FROZEN_NOW_ISO,
            };
            const steps: MissionStep[] = args.steps.map((s) => ({
              ...s,
              createdAt: FROZEN_NOW_ISO,
            }));
            store.missions.push(mission);
            store.steps.push(...steps);
            return { mission, steps };
          },
        },
        ids,
        clock: makeClock(),
      },
    );

    expect(store.missions).toHaveLength(1);
    expect(store.steps).toHaveLength(3);

    const ports = makePorts(store, {});
    const report = await runDailyAgencyCycle({ tenantId: TENANT_A }, ports);

    expect(report.dispatches).toHaveLength(1);
    expect(report.dispatches[0]!.missionFinished).toBe(true);
    expect(report.dispatches[0]!.newMissionStatus).toBe('completed');
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]!.outcomeKind).toBe('success');
    expect(store.missions[0]!.status).toBe('completed');
    expect(store.outcomes).toHaveLength(1);
  });

  it('AUTONOMOUS+LOW dispatch never prompts HITL — hitl port is a stub that throws if invoked', async () => {
    const store = buildStore();
    const mission: AgencyMission = {
      id: 'mis-A',
      tenantId: TENANT_A,
      assignedByUserId: USER_A,
      ownerPersonaId: null,
      title: 'Auto',
      goal: 'Autonomous test',
      contextJsonb: {},
      expectedCompletionDate: null,
      riskTier: 'LOW',
      autonomyTier: 'AUTONOMOUS',
      status: 'active',
      budgetMinorUnits: null,
      spentMinorUnits: 0,
      assetRefs: [],
      auditChainId: null,
      createdAt: FROZEN_NOW_ISO,
      updatedAt: FROZEN_NOW_ISO,
      completedAt: null,
    };
    store.missions.push(mission);
    store.steps.push({
      id: 'mst-A',
      tenantId: TENANT_A,
      missionId: 'mis-A',
      ordinal: 0,
      title: 'Execute',
      description: null,
      stepKind: 'execute',
      actionPlanId: null,
      status: 'pending',
      scheduledFor: FROZEN_TODAY,
      attempts: 0,
      resultJsonb: null,
      startedAt: null,
      completedAt: null,
      createdAt: FROZEN_NOW_ISO,
    });

    const ports = makePorts(store, {});
    ports.stepDispatcher.hitl = {
      async isApproved() {
        throw new Error('HITL should never be consulted for AUTONOMOUS+LOW');
      },
    };

    const report = await runDailyAgencyCycle({ tenantId: TENANT_A }, ports);
    expect(report.errorCount).toBe(0);
    expect(report.dispatches[0]!.dispatched).toHaveLength(1);
    expect(report.dispatches[0]!.dispatched[0]!.status).toBe('completed');
  });

  it('drift detected at checkpoint triggers HITL replan on HITL_HIGH mission', async () => {
    const store = buildStore();
    const mission: AgencyMission = {
      id: 'mis-B',
      tenantId: TENANT_A,
      assignedByUserId: USER_A,
      ownerPersonaId: null,
      title: 'HITL',
      goal: 'HITL test',
      contextJsonb: {},
      expectedCompletionDate: '2020-01-01',
      riskTier: 'MEDIUM',
      autonomyTier: 'HITL_HIGH',
      status: 'active',
      budgetMinorUnits: null,
      spentMinorUnits: 0,
      assetRefs: [],
      auditChainId: null,
      createdAt: FROZEN_NOW_ISO,
      updatedAt: FROZEN_NOW_ISO,
      completedAt: null,
    };
    store.missions.push(mission);
    store.steps.push({
      id: 'mst-B',
      tenantId: TENANT_A,
      missionId: 'mis-B',
      ordinal: 0,
      title: 'Execute',
      description: null,
      stepKind: 'execute',
      actionPlanId: null,
      status: 'pending',
      scheduledFor: FROZEN_TODAY,
      attempts: 0,
      resultJsonb: null,
      startedAt: null,
      completedAt: null,
      createdAt: FROZEN_NOW_ISO,
    });
    store.checkpoints.push({
      id: 'cpt-B',
      tenantId: TENANT_A,
      missionId: 'mis-B',
      checkpointKind: 'daily',
      scheduledAt: '2026-05-22T08:00:00.000Z',
      status: 'pending',
      summary: null,
      gapsJsonb: null,
      driftSignalsJsonb: null,
      needsHumanReview: false,
      reviewedAt: null,
      reviewedByUserId: null,
      createdAt: FROZEN_NOW_ISO,
    });

    const freshDriftSignals: DriftSignal[] = [
      {
        kind: 'deadline_slip',
        message: 'late',
        observedAt: FROZEN_NOW_ISO,
        details: {},
      },
    ];

    const ports = makePorts(store, { freshDriftSignals });
    // Suppress HITL approval for dispatch so the test isolates the
    // replan-engine path.
    ports.stepDispatcher.hitl = { isApproved: async () => false };

    const report = await runDailyAgencyCycle({ tenantId: TENANT_A }, ports);
    expect(report.checkpointReport.checkpointIds).toEqual(['cpt-B']);
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.action).toBe('queued-for-hitl');
    // Drift event recorded but mission plan not yet mutated.
    expect(store.drifts).toHaveLength(1);
    expect(store.drifts[0]!.driftKind).toBe('deadline_slip');
    expect(store.drifts[0]!.approvedAt).toBeNull();
  });

  it('continues on adapter error and surfaces an error count', async () => {
    const store = buildStore();
    const ports = makePorts(store, {});
    ports.cronRepository = {
      ...ports.cronRepository,
      async readActiveMissions() {
        throw new Error('db unavailable');
      },
    };
    const report = await runDailyAgencyCycle({ tenantId: TENANT_A }, ports);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    expect(report.dispatches).toEqual([]);
  });
});
