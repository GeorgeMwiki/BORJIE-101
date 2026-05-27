/**
 * `@borjie/mining-shift-planner` — public surface.
 *
 * Wraps `@borjie/workforce-orchestrator` (worker context),
 * `@borjie/mine-planner-advisor` (24h plan), `@borjie/regulatory-tz-mining`
 * (OSHA-TZ overrides — pending in that pkg, encoded locally here),
 * `@borjie/assignment-registry` (sink for finalized assignments).
 */

export {
  createMiningShiftPlanner,
  type MiningShiftPlanner,
  type MiningShiftPlannerDeps,
} from './planner.js';

export { solveShiftPlan } from './solver.js';
export { scoreFatigue } from './fatigue.js';
export {
  evaluateOshaRules,
  buildComplianceReport,
  DEFAULT_OSHA_THRESHOLDS,
  type OshaThresholds,
} from './osha-rules.js';

export {
  shiftRequestSchema,
  shiftPlanSchema,
  shiftAssignmentSchema,
  shiftTaskSchema,
  workerSchema,
  equipmentSchema,
  workShiftRecordSchema,
  fatigueScoreSchema,
  oshaRuleResultSchema,
  complianceReportSchema,
  shiftKindSchema,
  taskZoneSchema,
  certificationSchema,
  equipmentKindSchema,
  severitySchema,
  type ShiftRequest,
  type ShiftPlan,
  type ShiftAssignment,
  type ShiftTask,
  type Worker,
  type Equipment,
  type WorkShiftRecord,
  type FatigueScore,
  type OshaRuleResult,
  type ComplianceReport,
  type ShiftKind,
  type TaskZone,
  type Certification,
  type EquipmentKind,
  type Severity,
} from './types.js';

export {
  ShiftPlannerError,
  OverloadedScheduleError,
  OshaViolationError,
  FatigueExceededError,
  type ShiftPlannerErrorCode,
} from './errors.js';

export {
  NOOP_LOGGER,
  createInMemoryAssignmentSink,
  createInMemoryOshaRulebook,
  type Logger,
  type AssignmentSinkPort,
  type OshaRulebookPort,
} from './ports.js';
