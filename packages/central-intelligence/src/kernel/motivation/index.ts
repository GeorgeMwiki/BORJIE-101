/**
 * `motivation` — public surface of the motivational subsystem (Wave 1).
 *
 * The standing estate DRIVES + the engine that turns an unsatisfied drive into
 * a self-formulated goal with NO incoming trigger. Pure; the EstateMind loop
 * routes the goals to the gated proactive sink as PROPOSALS.
 */

export {
  DRIVE_IDS,
  type DriveId,
  type DriveUrgency,
  type DriveThresholds,
  type DriveAssessment,
  type Drive,
  type MotivatedGoal,
} from './types.js';

export {
  DEFAULT_DRIVES,
  DEFAULT_DRIVE_THRESHOLDS,
  CASH_RUNWAY_DRIVE,
  LICENCE_CURRENCY_DRIVE,
  SAFETY_DRIVE,
  OFFTAKE_COVERAGE_DRIVE,
  ROYALTY_CURRENCY_DRIVE,
  EQUIPMENT_HEALTH_DRIVE,
} from './default-drives.js';

export {
  createMotivationEngine,
  type MotivationEngine,
  type MotivationEngineDeps,
} from './motivation-engine.js';
