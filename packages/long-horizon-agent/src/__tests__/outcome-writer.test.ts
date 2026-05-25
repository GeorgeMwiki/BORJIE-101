import { describe, it, expect } from 'vitest';
import {
  finaliseOutcome,
  computeMetrics,
  extractLessons,
  type OutcomeNarratorPort,
  type OutcomeRepositoryPort,
  type ReflexionFeedPort,
} from '../outcome-writer.js';
import type {
  AgencyMission,
  MissionDriftEvent,
  MissionOutcome,
  MissionStep,
} from '../types.js';
import {
  makeMission,
  makeStep,
  makeDrift,
  makeIdGenerator,
  makeClock,
  TENANT_A,
  FROZEN_NOW_ISO,
} from './_fixtures.js';

describe('outcome-writer — computeMetrics', () => {
  it('counts steps by terminal status', () => {
    const m = computeMetrics({
      mission: makeMission({ createdAt: '2026-05-01T00:00:00.000Z', spentMinorUnits: 1234 }),
      steps: [
        makeStep({ id: 'a', status: 'completed' }),
        makeStep({ id: 'b', status: 'completed' }),
        makeStep({ id: 'c', status: 'failed' }),
        makeStep({ id: 'd', status: 'skipped' }),
        makeStep({ id: 'e', status: 'pending' }),
      ],
      drifts: [
        makeDrift({ id: 'd1', driftKind: 'step_replan' }),
        makeDrift({ id: 'd2', driftKind: 'step_replan' }),
        makeDrift({ id: 'd3', driftKind: 'external_blocker' }),
      ],
      nowIso: '2026-05-22T00:00:00.000Z',
    });
    expect(m.stepsCompleted).toBe(2);
    expect(m.stepsFailed).toBe(1);
    expect(m.stepsSkipped).toBe(1);
    expect(m.replans).toBe(2);
    expect(m.escalations).toBe(1);
    expect(m.daysElapsed).toBe(21);
    expect(m.costMinorUnits).toBe(1234);
  });

  it('returns 0 days elapsed for an invalid timestamp', () => {
    const m = computeMetrics({
      mission: makeMission({ createdAt: 'not-a-date' }),
      steps: [],
      drifts: [],
      nowIso: FROZEN_NOW_ISO,
    });
    expect(m.daysElapsed).toBe(0);
  });
});

describe('outcome-writer — extractLessons', () => {
  it('produces a lesson per failed step', () => {
    const lessons = extractLessons({
      mission: makeMission(),
      steps: [
        makeStep({ id: 'a', status: 'failed', attempts: 2, title: 'Sign lease' }),
        makeStep({ id: 'b', status: 'failed', attempts: 5, title: 'Send WhatsApp' }),
      ],
      drifts: [],
      outcomeKind: 'failed',
    });
    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.sourceStepIds).toEqual(['a']);
    expect(lessons[0]!.confidence).toBeGreaterThan(0);
    expect(lessons[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('produces lessons for drifts', () => {
    const lessons = extractLessons({
      mission: makeMission(),
      steps: [],
      drifts: [
        makeDrift({ id: 'd1', driftKind: 'budget_overrun', description: 'spent 200%' }),
        makeDrift({ id: 'd2', driftKind: 'goal_shift', description: 'pivot' }),
        makeDrift({ id: 'd3', driftKind: 'deadline_slip' }),
      ],
      outcomeKind: 'partial',
    });
    expect(lessons.some((l) => l.lesson.includes('Budget overrun'))).toBe(true);
    expect(lessons.some((l) => l.lesson.includes('goal_shift'))).toBe(true);
    expect(lessons.some((l) => l.lesson.includes('Deadline slip'))).toBe(true);
  });

  it('produces a positive lesson for clean successes', () => {
    const lessons = extractLessons({
      mission: makeMission({ title: 'Clean mission' }),
      steps: [makeStep({ id: 'a', status: 'completed' })],
      drifts: [],
      outcomeKind: 'success',
    });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.lesson).toContain('Clean mission');
    expect(lessons[0]!.sourceStepIds).toEqual(['a']);
  });
});

describe('outcome-writer — finaliseOutcome', () => {
  function buildRepo(opts: {
    mission: AgencyMission | null;
    steps: ReadonlyArray<MissionStep>;
    drifts: ReadonlyArray<MissionDriftEvent>;
    inserted?: MissionOutcome[];
  }): {
    repo: OutcomeRepositoryPort;
    captured: MissionOutcome[];
  } {
    const captured = opts.inserted ?? [];
    const repo: OutcomeRepositoryPort = {
      async readMission() {
        return opts.mission;
      },
      async readAllSteps() {
        return opts.steps;
      },
      async readAllDrifts() {
        return opts.drifts;
      },
      async insertOutcome(o) {
        const persisted: MissionOutcome = { ...o, createdAt: FROZEN_NOW_ISO };
        captured.push(persisted);
        return persisted;
      },
    };
    return { repo, captured };
  }

  it('end-to-end writes outcome + reflexion entries', async () => {
    const mission = makeMission({ status: 'completed', spentMinorUnits: 500 });
    const steps = [
      makeStep({ id: 'a', status: 'completed' }),
      makeStep({ id: 'b', status: 'completed' }),
    ];
    const drifts: MissionDriftEvent[] = [];
    const { repo, captured } = buildRepo({ mission, steps, drifts });

    const narrator: OutcomeNarratorPort = {
      narrate: async ({ outcomeKind }) =>
        `Mission outcome=${outcomeKind} narrative`,
    };
    const reflexionRecords: Array<{ taskId: string; reflection: string }> = [];
    const reflexion: ReflexionFeedPort = {
      record: async (args) => {
        reflexionRecords.push({ taskId: args.taskId, reflection: args.reflection });
        return { id: `refl-${reflexionRecords.length}` };
      },
    };

    const report = await finaliseOutcome(
      { tenantId: TENANT_A, missionId: mission.id, outcomeKind: 'success' },
      {
        narrator,
        repository: repo,
        reflexion,
        ids: makeIdGenerator(),
        clock: makeClock(),
      },
    );

    expect(report.skipped).toBe(false);
    expect(report.outcomeKind).toBe('success');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.narrative).toContain('outcome=success');
    expect(captured[0]!.metricsJsonb.stepsCompleted).toBe(2);
    expect(reflexionRecords).toHaveLength(1);
  });

  it('skips reflexion errors silently', async () => {
    const mission = makeMission({ status: 'completed' });
    const steps = [makeStep({ status: 'completed' })];
    const { repo, captured } = buildRepo({ mission, steps, drifts: [] });
    const narrator: OutcomeNarratorPort = { narrate: async () => 'narrative' };
    const reflexion: ReflexionFeedPort = {
      record: async () => {
        throw new Error('reflexion backend down');
      },
    };
    const report = await finaliseOutcome(
      { tenantId: TENANT_A, missionId: mission.id, outcomeKind: 'success' },
      { narrator, repository: repo, reflexion, ids: makeIdGenerator(), clock: makeClock() },
    );
    expect(report.skipped).toBe(false);
    expect(report.reflexionIdsWritten).toEqual([]);
    expect(captured).toHaveLength(1);
  });

  it('returns skipped report when mission not found', async () => {
    const { repo } = buildRepo({ mission: null, steps: [], drifts: [] });
    const report = await finaliseOutcome(
      { tenantId: TENANT_A, missionId: 'missing', outcomeKind: 'failed' },
      {
        narrator: { narrate: async () => 'x' },
        repository: repo,
        reflexion: { record: async () => ({ id: 'r' }) },
        ids: makeIdGenerator(),
        clock: makeClock(),
      },
    );
    expect(report.skipped).toBe(true);
    expect(report.outcomeId).toBe('');
  });

  it('maps failed outcome to failure for reflexion', async () => {
    const mission = makeMission({ status: 'escalated' });
    const steps = [makeStep({ id: 'a', status: 'failed', attempts: 3 })];
    const { repo } = buildRepo({ mission, steps, drifts: [] });
    let capturedOutcome = '';
    const reflexion: ReflexionFeedPort = {
      record: async (args) => {
        capturedOutcome = args.outcome;
        return { id: 'r' };
      },
    };
    await finaliseOutcome(
      { tenantId: TENANT_A, missionId: mission.id, outcomeKind: 'failed' },
      {
        narrator: { narrate: async () => 'x' },
        repository: repo,
        reflexion,
        ids: makeIdGenerator(),
        clock: makeClock(),
      },
    );
    expect(capturedOutcome).toBe('failure');
  });
});
