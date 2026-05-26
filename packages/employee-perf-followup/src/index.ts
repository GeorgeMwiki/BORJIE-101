/**
 * `@borjie/employee-perf-followup` — public surface (Wave PERF-1).
 *
 * Mr. Mwikila follows up on every employee's daily performance. For
 * each employee in scope, the package computes a daily scorecard
 * (role-default KPIs + assignments + outputs), surfaces it to
 *   (a) the employee with a coaching nudge,
 *   (b) the direct supervisor with a redacted summary,
 *   (c) the owner with aggregate stats only,
 * per FOUNDER_LOCKED_DECISIONS_2026_05_26 §3 (three-tier privacy).
 *
 * Spec: Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md.
 *
 * The package is pure — no HTTP, SMTP, WhatsApp, or database client
 * code. Production hosts wire concrete adapters through the
 * repository ports declared in `types.ts`.
 *
 * Locked default per
 * Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md (Decisions §1, §3, §4).
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Constants
  DEFAULT_FIRE_HOUR,
  DEFAULT_FIRE_MINUTE,
  QUIET_HOURS_START,
  QUIET_HOURS_END,
  MAX_NUDGE_WORDS,
  SEED_TENANT_ID,
  SUPERVISOR_TIER_SENTENCE_CAP,
  // Enums
  ROLE_KEYS,
  KPI_DIRECTIONS,
  RECIPIENT_TIERS,
  NUDGE_CHANNELS,
  KPI_BANDS,
  type RoleKey,
  type KpiDirection,
  type RecipientTier,
  type NudgeChannel,
  type KpiBand,
  // Domain types
  type Kpi,
  type RoleKpiTemplate,
  type KpiResult,
  type EmployeeScorecard,
  type TieredView,
  type AggregateOwnerStats,
  type PerfNudge,
  // Ports
  type ScorecardRepository,
  type KpiTemplateRepository,
  type PerfNudgeRepository,
  type KpiMeasurementPort,
  type KpiMeasurementInput,
  type OrgScopeResolver,
  type VoiceModeReader,
  type AuditChainPort,
  // Error
  EmployeePerfFollowupError,
  // Zod
  kpiSchema,
  kpiDirectionSchema,
  recipientTierSchema,
  nudgeChannelSchema,
  roleKpiTemplateInsertSchema,
  employeeScorecardInsertSchema,
  perfNudgeInsertSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// KPI templates (role defaults)
// ---------------------------------------------------------------------------
export {
  SEED_KPIS_BY_ROLE,
  buildSeedTemplate,
  buildAllSeedTemplates,
  validateRoleTemplate,
} from './kpi/role-templates.js';

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------
export {
  bandFor,
  scoreKpi,
  computeScorecard,
  type ScoreInput,
  type ScoreDeps,
} from './score/scorer.js';

// ---------------------------------------------------------------------------
// Tier renderer
// ---------------------------------------------------------------------------
export {
  renderTier,
  renderCrossTenantView,
  truncateToSentences,
  type RenderInput,
} from './tier/recipient-tier-renderer.js';

// ---------------------------------------------------------------------------
// Coach nudge generator
// ---------------------------------------------------------------------------
export {
  generateCoachNudge,
  createReferenceCoachNudgeGenerator,
  pickWorstKpi,
  pickBestKpi,
  type CoachNudgeInput,
  type CoachVoice,
  type CoachNudgeGenerator,
} from './nudge/coach-nudge.js';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export {
  runDailyPerfCronOnce,
  isInQuietHours,
  timeOfDayInTimezone,
  dateStringInTimezone,
  previousDateStringInTimezone,
  type EmployeeRoster,
  type EmployeeScheduleConfig,
  type DailyPerfCronDeps,
  type ScheduleTickResult,
} from './scheduler/daily-perf-cron.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------
export { createInMemoryScorecardRepository } from './repositories/scorecard.js';
export { createInMemoryKpiTemplateRepository } from './repositories/kpi-template.js';
export { createInMemoryPerfNudgeRepository } from './repositories/nudge.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export {
  createInMemoryAuditChain,
  stableHash,
} from './audit/in-memory-audit-chain.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export {
  buildPerfFollowupLogger,
  type PerfFollowupLoggerOptions,
} from './logger.js';
