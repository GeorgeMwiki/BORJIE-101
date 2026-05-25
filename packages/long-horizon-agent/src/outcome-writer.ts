/**
 * Outcome writer — Piece Q.
 *
 * When a mission reaches a terminal status (completed / abandoned /
 * escalated) the cron calls finaliseOutcome() which:
 *
 *   1. Reads the mission + all steps + all drift events.
 *   2. Computes metrics_jsonb (KPI block).
 *   3. Asks the narrator port to compose the human-readable narrative.
 *   4. Extracts lessons from drift events + failed steps.
 *   5. Inserts a single mission_outcomes row (UNIQUE constraint on
 *      mission_id makes this idempotent — second call is a no-op via
 *      the repository's INSERT … ON CONFLICT DO NOTHING).
 *   6. Feeds each lesson into the Reflexion buffer.
 *
 * All ports are injected; tests pass minimal stubs.
 */

import {
  type AgencyMission,
  type LessonLearned,
  type MissionDriftEvent,
  type MissionMetrics,
  type MissionOutcome,
  type MissionStep,
  type OutcomeKind,
} from './types.js';

export interface OutcomeNarratorPort {
  /**
   * Compose the narrative paragraph for a mission outcome. Production
   * wires the kernel narrator; tests pass a deterministic stub.
   */
  narrate(args: {
    readonly mission: AgencyMission;
    readonly steps: ReadonlyArray<MissionStep>;
    readonly drifts: ReadonlyArray<MissionDriftEvent>;
    readonly outcomeKind: OutcomeKind;
    readonly metrics: MissionMetrics;
  }): Promise<string>;
}

export interface OutcomeRepositoryPort {
  readMission(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<AgencyMission | null>;

  readAllSteps(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<ReadonlyArray<MissionStep>>;

  readAllDrifts(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<ReadonlyArray<MissionDriftEvent>>;

  /**
   * Insert outcome row idempotently — implementations should use
   * INSERT … ON CONFLICT (mission_id) DO NOTHING.
   *
   * Returns the inserted row or the existing row if already present.
   */
  insertOutcome(
    outcome: Omit<MissionOutcome, 'createdAt'>,
  ): Promise<MissionOutcome>;
}

/**
 * Port shape mirrors `packages/central-intelligence/src/kernel/reflexion`
 * `ReflexionRecorderPort` so the composition root can pass the real
 * adapter directly. Re-defined here to avoid a workspace dependency
 * on central-intelligence; the consumer of long-horizon-agent will
 * pass the same shape.
 */
export interface ReflexionFeedPort {
  record(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly taskId: string;
    readonly reflection: string;
    readonly outcome: 'success' | 'failure' | 'partial' | 'abandoned';
    readonly importance: number;
  }): Promise<{ id: string }>;
}

export interface IdGeneratorPort {
  nextId(prefix: string): string;
}

export interface ClockPort {
  nowIso(): string;
}

export interface OutcomeWriterDeps {
  readonly narrator: OutcomeNarratorPort;
  readonly repository: OutcomeRepositoryPort;
  readonly reflexion: ReflexionFeedPort;
  readonly ids: IdGeneratorPort;
  readonly clock: ClockPort;
}

export interface FinaliseOutcomeArgs {
  readonly tenantId: string;
  readonly missionId: string;
  /** Hint from the cron — the repository value still wins if it differs. */
  readonly outcomeKind: OutcomeKind;
}

export interface FinaliseOutcomeReport {
  readonly outcomeId: string;
  readonly outcomeKind: OutcomeKind;
  readonly reflexionIdsWritten: ReadonlyArray<string>;
  readonly skipped: boolean;
}

export async function finaliseOutcome(
  args: FinaliseOutcomeArgs,
  deps: OutcomeWriterDeps,
): Promise<FinaliseOutcomeReport> {
  const mission = await deps.repository.readMission({
    tenantId: args.tenantId,
    missionId: args.missionId,
  });
  if (!mission) {
    return {
      outcomeId: '',
      outcomeKind: args.outcomeKind,
      reflexionIdsWritten: [],
      skipped: true,
    };
  }

  const [steps, drifts] = await Promise.all([
    deps.repository.readAllSteps({
      tenantId: args.tenantId,
      missionId: args.missionId,
    }),
    deps.repository.readAllDrifts({
      tenantId: args.tenantId,
      missionId: args.missionId,
    }),
  ]);

  const metrics = computeMetrics({
    mission,
    steps,
    drifts,
    nowIso: deps.clock.nowIso(),
  });

  const narrative = await deps.narrator.narrate({
    mission,
    steps,
    drifts,
    outcomeKind: args.outcomeKind,
    metrics,
  });

  const lessons = extractLessons({ mission, steps, drifts, outcomeKind: args.outcomeKind });

  const outcomeRow: Omit<MissionOutcome, 'createdAt'> = {
    id: deps.ids.nextId('mio'),
    tenantId: args.tenantId,
    missionId: args.missionId,
    outcomeKind: args.outcomeKind,
    narrative,
    metricsJsonb: metrics,
    lessonsLearnedJsonb: [...lessons],
  };

  const persisted = await deps.repository.insertOutcome(outcomeRow);

  const reflexionIds: string[] = [];
  for (const lesson of lessons) {
    try {
      const { id } = await deps.reflexion.record({
        tenantId: args.tenantId,
        userId: mission.assignedByUserId,
        sessionId: `mission:${mission.id}`,
        taskId: `mission:${mission.id}`,
        reflection: lesson.lesson,
        outcome: mapOutcome(args.outcomeKind),
        importance: lesson.confidence,
      });
      reflexionIds.push(id);
    } catch {
      // Reflexion write is best-effort; never block outcome finalisation.
    }
  }

  return {
    outcomeId: persisted.id,
    outcomeKind: args.outcomeKind,
    reflexionIdsWritten: reflexionIds,
    skipped: false,
  };
}

/**
 * Pure metric computation — exported for tests.
 */
export function computeMetrics(args: {
  readonly mission: AgencyMission;
  readonly steps: ReadonlyArray<MissionStep>;
  readonly drifts: ReadonlyArray<MissionDriftEvent>;
  readonly nowIso: string;
}): MissionMetrics {
  const stepsCompleted = args.steps.filter(
    (s) => s.status === 'completed',
  ).length;
  const stepsFailed = args.steps.filter((s) => s.status === 'failed').length;
  const stepsSkipped = args.steps.filter((s) => s.status === 'skipped').length;
  const replans = args.drifts.filter((d) => d.driftKind === 'step_replan').length;
  const escalations = args.drifts.filter(
    (d) => d.driftKind === 'external_blocker',
  ).length;
  const daysElapsed = computeDaysElapsed(args.mission.createdAt, args.nowIso);
  return {
    stepsCompleted,
    stepsFailed,
    stepsSkipped,
    daysElapsed,
    costMinorUnits: args.mission.spentMinorUnits,
    replans,
    escalations,
  };
}

/**
 * Extract lessons from drift events + failed steps. Pure — exported.
 */
export function extractLessons(args: {
  readonly mission: AgencyMission;
  readonly steps: ReadonlyArray<MissionStep>;
  readonly drifts: ReadonlyArray<MissionDriftEvent>;
  readonly outcomeKind: OutcomeKind;
}): ReadonlyArray<LessonLearned> {
  const lessons: LessonLearned[] = [];

  for (const failed of args.steps.filter((s) => s.status === 'failed')) {
    lessons.push({
      lesson: `Step "${failed.title}" (kind=${failed.stepKind}) failed after ${failed.attempts} attempt(s). Future similar missions should pre-flight this step.`,
      confidence: clamp01(0.4 + failed.attempts * 0.1),
      sourceStepIds: [failed.id],
    });
  }

  for (const drift of args.drifts) {
    if (drift.driftKind === 'goal_shift') {
      lessons.push({
        lesson: `Mission "${args.mission.title}" required a goal_shift: ${drift.description}. The original framing was insufficient.`,
        confidence: 0.7,
        sourceStepIds: [],
      });
    }
    if (drift.driftKind === 'budget_overrun') {
      lessons.push({
        lesson: `Budget overrun on mission "${args.mission.title}": ${drift.description}. Future budget estimates should be increased.`,
        confidence: 0.6,
        sourceStepIds: [],
      });
    }
    if (drift.driftKind === 'deadline_slip') {
      lessons.push({
        lesson: `Deadline slip on mission "${args.mission.title}". Future planning should add buffer time.`,
        confidence: 0.5,
        sourceStepIds: [],
      });
    }
  }

  if (args.outcomeKind === 'success' && lessons.length === 0) {
    lessons.push({
      lesson: `Mission "${args.mission.title}" succeeded without drift. Pattern is worth reusing.`,
      confidence: 0.6,
      sourceStepIds: args.steps.map((s) => s.id),
    });
  }

  return lessons;
}

function computeDaysElapsed(createdAtIso: string, nowIso: string): number {
  const start = new Date(createdAtIso).getTime();
  const end = new Date(nowIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end - start) / dayMs));
}

function mapOutcome(
  kind: OutcomeKind,
): 'success' | 'failure' | 'partial' | 'abandoned' {
  switch (kind) {
    case 'success':
      return 'success';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failure';
    case 'abandoned':
      return 'abandoned';
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
