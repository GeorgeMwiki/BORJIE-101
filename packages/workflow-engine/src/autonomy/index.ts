/**
 * Flow-keyed autonomy barrel — the per-flow `auto | gated` posture seam
 * (migration 0308 / `flow_autonomy_prefs`).
 */

export {
  FLOW_AUTONOMY_POSTURES,
  FLOW_CONFIRMATION_STATES,
  isFlowAuto,
  type FlowAutonomyPosture,
  type FlowConfirmationState,
  type FlowAutonomyPref,
  type FlowAutonomyRepository,
  type RecordFlowCreationInput,
  type SetFlowPostureInput,
} from './flow-autonomy-port.js';
export { createInMemoryFlowAutonomyRepository } from './in-memory-flow-autonomy-repository.js';
export { createDrizzleFlowAutonomyRepository } from '../repositories/drizzle-flow-autonomy-repository.js';
