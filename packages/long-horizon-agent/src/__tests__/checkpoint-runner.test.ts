import { describe, it, expect } from 'vitest';
import {
  runDueCheckpoints,
  computeGaps,
  shouldFlagForReview,
  type CheckpointRepositoryPort,
  type CheckpointSummariserPort,
  type ProgressBriefWriterPort,
} from '../checkpoint-runner.js';
import type {
  AgencyMission,
  CheckpointGap,
  DriftSignal,
  MissionCheckpoint,
  MissionStep,
} from '../types.js';
import {
  makeMission,
  makeStep,
  makeCheckpoint,
  makeClock,
  TENANT_A,
  FROZEN_NOW_ISO,
} from './_fixtures.js';

describe('checkpoint-runner — computeGaps', () => {
  it('returns no gaps for a healthy mission', () => {
    expect(computeGaps(makeMission({ budgetMinorUnits: null }), [])).toEqual([]);
  });

  it('reports blocked steps as warning', () => {
    const gaps = computeGaps(makeMission(), [
      makeStep({ id: 'mst-1', status: 'blocked' }),
    ]);
    expect(gaps.find((g) => g.kind === 'blocked_steps')?.severity).toBe('warning');
  });

  it('reports failed steps as critical', () => {
    const gaps = computeGaps(makeMission(), [
      makeStep({ id: 'mst-1', status: 'failed' }),
    ]);
    expect(gaps.find((g) => g.kind === 'failed_steps')?.severity).toBe('critical');
  });

  it('warns at 80% budget consumption', () => {
    const m = makeMission({ budgetMinorUnits: 1000, spentMinorUnits: 850 });
    const gaps = computeGaps(m, []);
    expect(gaps.find((g) => g.kind === 'budget_warning')).toBeTruthy();
  });

  it('does NOT warn when budget is null', () => {
    const m = makeMission({ budgetMinorUnits: null, spentMinorUnits: 0 });
    expect(computeGaps(m, [])).toEqual([]);
  });
});

describe('checkpoint-runner — shouldFlagForReview', () => {
  it('returns false when no drift signals', () => {
    expect(shouldFlagForReview(makeMission(), [])).toBe(false);
  });

  it('HITL_HIGH flags on any drift', () => {
    const sig: DriftSignal = {
      kind: 'step_replan',
      message: 'x',
      observedAt: FROZEN_NOW_ISO,
      details: {},
    };
    expect(
      shouldFlagForReview(makeMission({ autonomyTier: 'HITL_HIGH' }), [sig]),
    ).toBe(true);
  });

  it('AUTONOMOUS + LOW risk swallows all signals', () => {
    const sig: DriftSignal = {
      kind: 'deadline_slip',
      message: 'x',
      observedAt: FROZEN_NOW_ISO,
      details: {},
    };
    expect(
      shouldFlagForReview(
        makeMission({ autonomyTier: 'AUTONOMOUS', riskTier: 'LOW' }),
        [sig],
      ),
    ).toBe(false);
  });

  it('flags HITL_LOW on serious drift', () => {
    const sig: DriftSignal = {
      kind: 'budget_overrun',
      message: 'x',
      observedAt: FROZEN_NOW_ISO,
      details: {},
    };
    expect(
      shouldFlagForReview(makeMission({ autonomyTier: 'HITL_LOW' }), [sig]),
    ).toBe(true);
  });
});

describe('checkpoint-runner — runDueCheckpoints integration', () => {
  function makeRepo(opts: {
    missions: AgencyMission[];
    steps: Record<string, MissionStep[]>;
    checkpoints: MissionCheckpoint[];
  }): {
    repo: CheckpointRepositoryPort;
    completed: Map<string, { summary: string; gaps: ReadonlyArray<CheckpointGap>; drifts: ReadonlyArray<DriftSignal>; needsReview: boolean }>;
  } {
    const completed = new Map<
      string,
      {
        summary: string;
        gaps: ReadonlyArray<CheckpointGap>;
        drifts: ReadonlyArray<DriftSignal>;
        needsReview: boolean;
      }
    >();
    const repo: CheckpointRepositoryPort = {
      async readMission(args) {
        return opts.missions.find((m) => m.id === args.missionId) ?? null;
      },
      async readAllSteps(args) {
        return opts.steps[args.missionId] ?? [];
      },
      async readDueCheckpoints(args) {
        return opts.checkpoints.filter(
          (c) =>
            c.tenantId === args.tenantId &&
            c.status === 'pending' &&
            c.scheduledAt <= args.nowIso,
        );
      },
      async markCheckpointCompleted(args) {
        completed.set(args.checkpointId, {
          summary: args.summary,
          gaps: args.gaps,
          drifts: args.driftSignals,
          needsReview: args.needsHumanReview,
        });
      },
    };
    return { repo, completed };
  }

  it('marks daily checkpoint complete and skips weekly brief', async () => {
    const mission = makeMission({ status: 'active' });
    const steps = [makeStep({ id: 'mst-1', status: 'completed' })];
    const checkpoints = [
      makeCheckpoint({
        id: 'cpt-1',
        checkpointKind: 'daily',
        status: 'pending',
        scheduledAt: '2026-05-22T08:00:00.000Z',
      }),
    ];
    const { repo, completed } = makeRepo({
      missions: [mission],
      steps: { [mission.id]: steps },
      checkpoints,
    });
    const summariser: CheckpointSummariserPort = {
      summarise: async ({ checkpoint }) => `Summary for ${checkpoint.id}`,
    };
    let briefCount = 0;
    const briefWriter: ProgressBriefWriterPort = {
      writeBrief: async () => {
        briefCount += 1;
        return { briefId: 'brf-1' };
      },
    };
    const report = await runDueCheckpoints(
      { tenantId: TENANT_A },
      {
        summariser,
        briefWriter,
        repository: repo,
        clock: makeClock(),
      },
    );
    expect(report.checkpointIds).toEqual(['cpt-1']);
    expect(report.briefsWritten).toBe(0);
    expect(briefCount).toBe(0);
    expect(completed.get('cpt-1')?.summary).toBe('Summary for cpt-1');
  });

  it('writes the weekly brief on a weekly checkpoint', async () => {
    const mission = makeMission({ status: 'active' });
    const checkpoints = [
      makeCheckpoint({
        id: 'cpt-w',
        checkpointKind: 'weekly',
        scheduledAt: '2026-05-22T08:00:00.000Z',
      }),
    ];
    const { repo } = makeRepo({
      missions: [mission],
      steps: { [mission.id]: [] },
      checkpoints,
    });
    const summariser: CheckpointSummariserPort = {
      summarise: async () => 'Weekly summary',
    };
    let captured: { tenantId: string; summary: string } | null = null;
    const briefWriter: ProgressBriefWriterPort = {
      writeBrief: async (args) => {
        captured = { tenantId: args.tenantId, summary: args.summary };
        return { briefId: 'brf-2' };
      },
    };
    const report = await runDueCheckpoints(
      { tenantId: TENANT_A },
      {
        summariser,
        briefWriter,
        repository: repo,
        clock: makeClock(),
      },
    );
    expect(report.briefsWritten).toBe(1);
    expect(captured?.summary).toBe('Weekly summary');
  });

  it('queues human review when drift is critical on HITL_HIGH', async () => {
    const mission = makeMission({
      status: 'active',
      autonomyTier: 'HITL_HIGH',
      budgetMinorUnits: 100,
      spentMinorUnits: 999,
    });
    const checkpoints = [
      makeCheckpoint({
        id: 'cpt-1',
        scheduledAt: '2026-05-22T08:00:00.000Z',
      }),
    ];
    const { repo, completed } = makeRepo({
      missions: [mission],
      steps: { [mission.id]: [] },
      checkpoints,
    });
    const report = await runDueCheckpoints(
      { tenantId: TENANT_A },
      {
        summariser: { summarise: async () => 'sum' },
        briefWriter: { writeBrief: async () => ({ briefId: 'brf' }) },
        repository: repo,
        clock: makeClock(),
      },
    );
    expect(report.humanReviewQueued).toBe(1);
    expect(completed.get('cpt-1')?.needsReview).toBe(true);
  });

  it('skips missions not found', async () => {
    const checkpoints = [
      makeCheckpoint({
        id: 'cpt-orphan',
        missionId: 'mis-missing',
        scheduledAt: '2026-05-22T08:00:00.000Z',
      }),
    ];
    const { repo } = makeRepo({
      missions: [],
      steps: {},
      checkpoints,
    });
    const report = await runDueCheckpoints(
      { tenantId: TENANT_A },
      {
        summariser: { summarise: async () => 'x' },
        briefWriter: { writeBrief: async () => ({ briefId: 'b' }) },
        repository: repo,
        clock: makeClock(),
      },
    );
    expect(report.checkpointIds).toEqual([]);
  });
});
