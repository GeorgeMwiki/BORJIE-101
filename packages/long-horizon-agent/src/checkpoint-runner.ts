/**
 * Checkpoint runner — Piece Q.
 *
 * For each `mission_checkpoints` row whose scheduled_at <= now and
 * status='pending', the runner:
 *
 *   1. Reads the mission + all steps.
 *   2. Asks the drift_detector for current signals.
 *   3. Composes a summary (free-text — production wires the kernel
 *      narrator port; tests pass a pure stub).
 *   4. Marks needs_human_review when any drift signal is severity
 *      >= 'critical' OR the mission autonomy_tier requires HITL on a
 *      kind of drift the replan_engine refused to handle.
 *   5. For weekly checkpoints, also writes a progress brief via the
 *      brief writer port — the persona inbox / weekly digest UI picks
 *      it up.
 *
 * The runner is composable: it owns the side-effect-y "mark this
 * checkpoint complete" path but delegates summary composition and brief
 * authorship so callers can plug in different LLM / template engines.
 */

import {
  detectDrift,
  dedupeDriftSignals,
} from './drift-detector.js';
import {
  type AgencyMission,
  type CheckpointGap,
  type DriftSignal,
  type MissionCheckpoint,
  type MissionStep,
} from './types.js';

export interface CheckpointSummariserPort {
  /**
   * Compose a human-readable summary of progress since the prior
   * checkpoint. Returns a markdown / plain-text string. Implementations
   * typically wrap the kernel narrator; the test fake returns the
   * checkpoint kind + step count.
   */
  summarise(args: {
    readonly mission: AgencyMission;
    readonly steps: ReadonlyArray<MissionStep>;
    readonly checkpoint: MissionCheckpoint;
    readonly driftSignals: ReadonlyArray<DriftSignal>;
    readonly gaps: ReadonlyArray<CheckpointGap>;
  }): Promise<string>;
}

export interface ProgressBriefWriterPort {
  /**
   * Persist the weekly progress brief to the assigning persona's
   * inbox. Returns the persisted brief id so the audit chain can
   * reference it. Implementations: persona registry digest writer.
   */
  writeBrief(args: {
    readonly tenantId: string;
    readonly mission: AgencyMission;
    readonly checkpoint: MissionCheckpoint;
    readonly summary: string;
    readonly driftSignals: ReadonlyArray<DriftSignal>;
    readonly gaps: ReadonlyArray<CheckpointGap>;
  }): Promise<{ briefId: string }>;
}

export interface CheckpointRepositoryPort {
  readMission(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<AgencyMission | null>;

  readAllSteps(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<ReadonlyArray<MissionStep>>;

  readDueCheckpoints(args: {
    readonly tenantId: string;
    readonly nowIso: string;
  }): Promise<ReadonlyArray<MissionCheckpoint>>;

  markCheckpointCompleted(args: {
    readonly tenantId: string;
    readonly checkpointId: string;
    readonly summary: string;
    readonly gaps: ReadonlyArray<CheckpointGap>;
    readonly driftSignals: ReadonlyArray<DriftSignal>;
    readonly needsHumanReview: boolean;
  }): Promise<void>;
}

export interface ClockPort {
  nowIso(): string;
}

export interface CheckpointRunnerDeps {
  readonly summariser: CheckpointSummariserPort;
  readonly briefWriter: ProgressBriefWriterPort;
  readonly repository: CheckpointRepositoryPort;
  readonly clock: ClockPort;
}

export interface RunCheckpointsArgs {
  readonly tenantId: string;
  /**
   * Optional: when provided the runner only processes checkpoints for
   * this mission. Otherwise it sweeps every due checkpoint for the
   * tenant.
   */
  readonly missionId?: string;
}

export interface CheckpointRunReport {
  readonly checkpointIds: ReadonlyArray<string>;
  readonly briefsWritten: number;
  readonly humanReviewQueued: number;
}

export async function runDueCheckpoints(
  args: RunCheckpointsArgs,
  deps: CheckpointRunnerDeps,
): Promise<CheckpointRunReport> {
  const nowIso = deps.clock.nowIso();
  const allDue = await deps.repository.readDueCheckpoints({
    tenantId: args.tenantId,
    nowIso,
  });

  const due = args.missionId
    ? allDue.filter((c) => c.missionId === args.missionId)
    : allDue;

  const completedIds: string[] = [];
  let briefsWritten = 0;
  let humanReviewQueued = 0;

  for (const checkpoint of due) {
    const mission = await deps.repository.readMission({
      tenantId: args.tenantId,
      missionId: checkpoint.missionId,
    });
    if (!mission) continue;

    const steps = await deps.repository.readAllSteps({
      tenantId: args.tenantId,
      missionId: checkpoint.missionId,
    });

    const rawSignals = detectDrift({
      mission,
      steps,
      nowIso,
    });
    const driftSignals = dedupeDriftSignals(rawSignals);

    const gaps = computeGaps(mission, steps);

    const summary = await deps.summariser.summarise({
      mission,
      steps,
      checkpoint,
      driftSignals,
      gaps,
    });

    const needsHumanReview = shouldFlagForReview(mission, driftSignals);

    await deps.repository.markCheckpointCompleted({
      tenantId: args.tenantId,
      checkpointId: checkpoint.id,
      summary,
      gaps,
      driftSignals,
      needsHumanReview,
    });
    completedIds.push(checkpoint.id);
    if (needsHumanReview) humanReviewQueued += 1;

    if (checkpoint.checkpointKind === 'weekly') {
      await deps.briefWriter.writeBrief({
        tenantId: args.tenantId,
        mission,
        checkpoint,
        summary,
        driftSignals,
        gaps,
      });
      briefsWritten += 1;
    }
  }

  return {
    checkpointIds: completedIds,
    briefsWritten,
    humanReviewQueued,
  };
}

/**
 * Map mission + step state into the gap array the persona UI consumes.
 *
 * Pure — exported for tests.
 */
export function computeGaps(
  mission: AgencyMission,
  steps: ReadonlyArray<MissionStep>,
): ReadonlyArray<CheckpointGap> {
  const gaps: CheckpointGap[] = [];

  const blocked = steps.filter((s) => s.status === 'blocked');
  if (blocked.length > 0) {
    gaps.push({
      kind: 'blocked_steps',
      label: `${blocked.length} step(s) currently blocked`,
      severity: 'warning',
    });
  }

  const failed = steps.filter((s) => s.status === 'failed');
  if (failed.length > 0) {
    gaps.push({
      kind: 'failed_steps',
      label: `${failed.length} step(s) failed and not yet retried`,
      severity: 'critical',
    });
  }

  if (
    mission.budgetMinorUnits !== null &&
    mission.budgetMinorUnits > 0 &&
    mission.spentMinorUnits >= mission.budgetMinorUnits * 0.8 &&
    mission.spentMinorUnits <= mission.budgetMinorUnits
  ) {
    gaps.push({
      kind: 'budget_warning',
      label: 'Mission has spent >=80% of budget',
      severity: 'warning',
    });
  }

  return gaps;
}

/**
 * Decide whether a checkpoint needs human review given the mission's
 * autonomy tier and the drift signals observed.
 *
 * Pure — exported for tests.
 */
export function shouldFlagForReview(
  mission: AgencyMission,
  driftSignals: ReadonlyArray<DriftSignal>,
): boolean {
  if (driftSignals.length === 0) return false;

  if (mission.autonomyTier === 'HITL_HIGH') return true;

  // Any deadline_slip or budget_overrun always triggers review unless
  // the mission is fully AUTONOMOUS + LOW risk.
  const hasSerious = driftSignals.some(
    (s) =>
      s.kind === 'deadline_slip' ||
      s.kind === 'budget_overrun' ||
      s.kind === 'goal_shift',
  );

  if (mission.autonomyTier === 'AUTONOMOUS' && mission.riskTier === 'LOW') {
    return false;
  }

  return hasSerious;
}
