/**
 * Cron — Piece Q.
 *
 * Daily entry point. The production cron orchestrator wires this
 * function once per tenant per day:
 *
 *   for each tenant:
 *     bind tenant_id GUC
 *     await runDailyAgencyCycle({ tenantId })
 *
 * The cycle is deterministic, idempotent and bounded:
 *   1. Sweep due checkpoints (writes summaries, drift signals).
 *   2. Run replan engine for every fresh drift signal that came out
 *      of step 1.
 *   3. Dispatch today's pending steps for every active mission.
 *   4. Finalise outcomes for any mission that finished during dispatch.
 *
 * The function returns a report the cron framework persists as the
 * run's audit row.
 */

import {
  runDueCheckpoints,
  type CheckpointRunnerDeps,
  type CheckpointRunReport,
} from './checkpoint-runner.js';
import {
  dispatchMission,
  type StepDispatcherDeps,
  type DispatchMissionReport,
} from './step-dispatcher.js';
import {
  handleDrift,
  type ReplanEngineDeps,
  type ReplanReport,
} from './replan-engine.js';
import {
  finaliseOutcome,
  type OutcomeWriterDeps,
  type FinaliseOutcomeReport,
} from './outcome-writer.js';
import {
  type AgencyMission,
  type DriftSignal,
  type MissionCheckpoint,
  type OutcomeKind,
} from './types.js';

export interface CronRepositoryPort {
  /**
   * Active missions for this tenant whose status is in
   * ('planning', 'active', 'paused') AND have at least one step.
   * Bounded by `limit` to avoid runaway runs.
   */
  readActiveMissions(args: {
    readonly tenantId: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<AgencyMission>>;

  /**
   * Newly-completed checkpoints whose drift_signals_jsonb is non-empty
   * — for the replan engine to consume.
   */
  readFreshDriftSignals(args: {
    readonly tenantId: string;
    readonly checkpointIds: ReadonlyArray<string>;
  }): Promise<
    ReadonlyArray<{
      readonly checkpoint: MissionCheckpoint;
      readonly signals: ReadonlyArray<DriftSignal>;
    }>
  >;
}

export interface CronDeps {
  readonly checkpointRunner: CheckpointRunnerDeps;
  readonly stepDispatcher: StepDispatcherDeps;
  readonly replanEngine: ReplanEngineDeps;
  readonly outcomeWriter: OutcomeWriterDeps;
  readonly cronRepository: CronRepositoryPort;
}

export interface DailyCycleArgs {
  readonly tenantId: string;
  /** Hard cap on missions inspected this run. */
  readonly missionLimit?: number;
}

export interface DailyCycleReport {
  readonly tenantId: string;
  readonly checkpointReport: CheckpointRunReport;
  readonly replans: ReadonlyArray<ReplanReport>;
  readonly dispatches: ReadonlyArray<DispatchMissionReport>;
  readonly outcomes: ReadonlyArray<FinaliseOutcomeReport>;
  readonly errorCount: number;
}

const DEFAULT_MISSION_LIMIT = 100;

export async function runDailyAgencyCycle(
  args: DailyCycleArgs,
  deps: CronDeps,
): Promise<DailyCycleReport> {
  const missionLimit = args.missionLimit ?? DEFAULT_MISSION_LIMIT;

  let errorCount = 0;

  // 1. Sweep due checkpoints across the tenant.
  let checkpointReport: CheckpointRunReport = {
    checkpointIds: [],
    briefsWritten: 0,
    humanReviewQueued: 0,
  };
  try {
    checkpointReport = await runDueCheckpoints(
      { tenantId: args.tenantId },
      deps.checkpointRunner,
    );
  } catch {
    errorCount += 1;
  }

  // 2. Handle drift signals from the freshly-completed checkpoints.
  const replans: ReplanReport[] = [];
  if (checkpointReport.checkpointIds.length > 0) {
    let driftBundles: ReadonlyArray<{
      readonly checkpoint: MissionCheckpoint;
      readonly signals: ReadonlyArray<DriftSignal>;
    }> = [];
    try {
      driftBundles = await deps.cronRepository.readFreshDriftSignals({
        tenantId: args.tenantId,
        checkpointIds: checkpointReport.checkpointIds,
      });
    } catch {
      errorCount += 1;
    }

    for (const bundle of driftBundles) {
      for (const signal of bundle.signals) {
        try {
          const report = await handleDrift(
            {
              tenantId: args.tenantId,
              missionId: bundle.checkpoint.missionId,
              signal,
            },
            deps.replanEngine,
          );
          replans.push(report);
        } catch {
          errorCount += 1;
        }
      }
    }
  }

  // 3. Dispatch today's pending steps across active missions.
  let activeMissions: ReadonlyArray<AgencyMission> = [];
  try {
    activeMissions = await deps.cronRepository.readActiveMissions({
      tenantId: args.tenantId,
      limit: missionLimit,
    });
  } catch {
    errorCount += 1;
  }

  const dispatches: DispatchMissionReport[] = [];
  const outcomes: FinaliseOutcomeReport[] = [];

  for (const mission of activeMissions) {
    try {
      const report = await dispatchMission(
        { tenantId: args.tenantId, missionId: mission.id },
        deps.stepDispatcher,
      );
      dispatches.push(report);

      if (
        report.missionFinished &&
        report.newMissionStatus !== null &&
        (report.newMissionStatus === 'completed' ||
          report.newMissionStatus === 'escalated')
      ) {
        try {
          const outcomeKind: OutcomeKind =
            report.newMissionStatus === 'completed' ? 'success' : 'failed';
          const outcomeReport = await finaliseOutcome(
            {
              tenantId: args.tenantId,
              missionId: mission.id,
              outcomeKind,
            },
            deps.outcomeWriter,
          );
          outcomes.push(outcomeReport);
        } catch {
          errorCount += 1;
        }
      }
    } catch {
      errorCount += 1;
    }
  }

  return {
    tenantId: args.tenantId,
    checkpointReport,
    replans,
    dispatches,
    outcomes,
    errorCount,
  };
}
