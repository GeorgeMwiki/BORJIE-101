/**
 * Public barrel for the process-mining subsystem.
 *
 * Consumers (the chat route, the pipeline API, the verifier-junior in
 * a later wave) pull from here so internals can evolve without
 * churning callers.
 *
 * @module features/central-command/md/process-mining
 */

export * from "./types";
export {
  makeEventLogService,
  __resetProcessEventsHashSecretForTests,
} from "./event-log-service";
export type {
  EventLogService,
  EventLogServiceDeps,
  EventLogSupabaseLike,
  AppendEventArgs,
  AppendEventResult,
  AppendManyResult,
} from "./event-log-service";
export { mineProcess } from "./process-miner";
export type { MineInput, MineResult } from "./process-miner";
export { detectBottlenecks } from "./bottleneck-detector";
export type { DetectInput } from "./bottleneck-detector";
export { checkConformance } from "./conformance-checker";
export type {
  ConformanceReport,
  ConformanceTrace,
  TraceConformance,
} from "./conformance-checker";
export { proposeRedesign } from "./redesign-proposer";
export type { ProposeRedesignInput } from "./redesign-proposer";
export { makePipelineCoordinator } from "./pipeline-coordinator";
export type {
  PipelineCoordinator,
  PipelineCoordinatorDeps,
  PipelineStageResult,
  PipelineSupabaseLike,
} from "./pipeline-coordinator";
