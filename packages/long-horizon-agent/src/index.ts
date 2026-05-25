/**
 * @borjie/long-horizon-agent — Piece Q.
 *
 * Public barrel. Composition roots (api-gateway, cron orchestrators)
 * import everything they need from this entry point.
 */

// Types + Zod schemas.
export * from './types.js';

// Mission planner.
export {
  planMission,
  normalisePlannedSteps,
  type MissionPlannerPort,
  type MissionRepositoryPort,
  type IdGeneratorPort,
  type ClockPort,
  type MissionPlannerDeps,
} from './mission-planner.js';

// Step dispatcher.
export {
  dispatchMission,
  needsApproval,
  type ActionRuntimePort,
  type HitlGatewayPort,
  type StepDispatcherRepositoryPort,
  type StepDispatcherDeps,
  type DispatchMissionArgs,
  type DispatchMissionReport,
} from './step-dispatcher.js';

// Drift detector.
export { detectDrift, dedupeDriftSignals, type DetectDriftArgs } from './drift-detector.js';

// Checkpoint runner.
export {
  runDueCheckpoints,
  computeGaps,
  shouldFlagForReview,
  type CheckpointSummariserPort,
  type ProgressBriefWriterPort,
  type CheckpointRepositoryPort,
  type CheckpointRunnerDeps,
  type RunCheckpointsArgs,
  type CheckpointRunReport,
} from './checkpoint-runner.js';

// Replan engine.
export {
  handleDrift,
  canAutoApply,
  composeRecipe,
  plannedStepsToInsertSteps,
  type ReplanRepositoryPort,
  type ReplanEngineDeps,
  type HandleDriftArgs,
  type ReplanReport,
} from './replan-engine.js';

// Outcome writer.
export {
  finaliseOutcome,
  computeMetrics,
  extractLessons,
  type OutcomeNarratorPort,
  type OutcomeRepositoryPort,
  type ReflexionFeedPort,
  type OutcomeWriterDeps,
  type FinaliseOutcomeArgs,
  type FinaliseOutcomeReport,
} from './outcome-writer.js';

// Cron orchestrator.
export {
  runDailyAgencyCycle,
  type CronRepositoryPort,
  type CronDeps,
  type DailyCycleArgs,
  type DailyCycleReport,
} from './cron.js';
