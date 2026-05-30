/**
 * Closed-Loop Process Layer — Public API.
 *
 * @module core/closed-loop
 */

export type {
  Action,
  Adjustment,
  ClosedLoopContext,
  ClosedLoopDefinition,
  ClosedLoopId,
  ClosedLoopOutcome,
  ClosedLoopScope,
  ClosedLoopState,
  ClosedLoopSteps,
  ClosedLoopTick,
  Decision,
  Measurement,
  Observation,
  Prediction,
} from "./types";

export {
  defineClosedLoop,
  runTick,
  NULL_SINK,
  type ClosedLoopSink,
  type ClosedLoopTickRow,
  type ClosedLoopAdjustmentRow,
  type ClosedLoopStateRow,
  type DefineClosedLoopArgs,
  type RunTickArgs,
} from "./runtime";

export { listLoops, getLoop, isClosedLoopId } from "./registry";

export { createSupabaseClosedLoopSink } from "./supabase-sink";
