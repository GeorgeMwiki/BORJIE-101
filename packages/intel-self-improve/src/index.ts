/**
 * `@borjie/intel-self-improve` — public surface (Wave INTEL-SELF-IMPROVE).
 *
 * Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
 * Tanzanian mining operators. Companion spec:
 * Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Six concerns exposed:
 *
 *   - types               — MeasuredCapability + IntelInvocationContext +
 *                           OutcomeObservation + IntelKind enumeration.
 *   - wrap                — `wrapAsMeasured` higher-order wrapper that
 *                           emits to intel_invocation_audit +
 *                           capability_invocations + intel_skill_traces.
 *   - verifiers           — 6 RLVR builtins (forecast / stat / graph /
 *                           causal / anomaly / recommendation).
 *   - measurers           — per-kind ground-truth measurers that reduce
 *                           raw observations to competence + calibration
 *                           + utility axes (capability-catalogue scoring).
 *   - observe             — outcome-observer cron worker.
 *   - curate              — intel-trace curator that shapes training pairs.
 *   - repositories        — port + in-memory + SQL adapters for the two
 *                           tenant-scoped tables backing migration 0072.
 *
 * @module @borjie/intel-self-improve
 */

// ── Types ─────────────────────────────────────────────────────────────
export {
  INTEL_KINDS,
  IntelInvocationContextSchema,
  IntelSkillTraceSchema,
  IntelSelfImproveError,
  OutcomeObservationSchema,
  type IntelInvocationContext,
  type IntelKind,
  type IntelSelfImproveErrorCode,
  type IntelSkillTrace,
  type MeasuredCapability,
  type OutcomeObservation,
} from './types.js';

// ── Wrap ──────────────────────────────────────────────────────────────
export {
  buildMeasuredCapability,
  emitTelemetry,
  patternSignatureFor,
  RANDOM_UUID_GEN,
  SYSTEM_CLOCK,
  wrapAsMeasured,
  type Clock,
  type EmitTelemetryArgs,
  type IdGen,
  type WrapAsMeasuredDeps,
} from './wrap/wrap-as-measured.js';

// ── Repositories ──────────────────────────────────────────────────────
export {
  createInMemoryIntelInvocationAuditRepository,
  createSqlIntelInvocationAuditRepository,
  type IntelInvocationAuditRepository,
  type IntelInvocationAuditRow,
  type SqlIntelInvocationAuditDriver,
} from './repositories/intel-invocation-audit-repository.js';
export {
  createInMemoryIntelSkillTracesRepository,
  createSqlIntelSkillTracesRepository,
  type IntelSkillTracesRepository,
  type SkillTraceTickInput,
  type SqlIntelSkillTracesDriver,
} from './repositories/intel-skill-traces-repository.js';
