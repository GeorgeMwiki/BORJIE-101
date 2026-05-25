/**
 * BORJIE AI heartbeat module — Wave-11 + Wave 27 (Part B.8 expansion).
 */

export {
  createHeartbeatEngine,
  DEFAULT_JUNIOR_IDLE_MS,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  FAST_CADENCE_MS,
  MEDIUM_CADENCE_MS,
  SLOW_CADENCE_MS,
  type HeartbeatEngine,
  type HeartbeatDeps,
  type HeartbeatTickInput,
  type HeartbeatTickResult,
  type HeartbeatEngineOptions,
  type HeartbeatDuty,
  type HeartbeatDutyContext,
  type HeartbeatCadence,
  type DutyTelemetryEntry,
  type JuniorSession,
} from './heartbeat-engine.js';

export {
  buildHeartbeatDutyRegistry,
  HEARTBEAT_DUTY_IDS,
  type DutyWorker,
  type DutyFactoryInput,
  type HeartbeatDutyKey,
  type HeartbeatDutyRegistryInput,
} from './duty-registry.js';
