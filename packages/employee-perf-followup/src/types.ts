/**
 * Employee Daily Performance Follow-up — public type surface (Wave PERF-1).
 *
 * Companion to Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md.
 * Every record here is immutable. State transitions produce new
 * projections via dedicated handlers — never an in-place mutation.
 * This mirrors the immutability discipline used across the Borjie
 * codebase.
 *
 * Locked default per
 * Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md (Decisions §1 + §3).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Default fire-time at the employee's local 06:00. Per spec §7. */
export const DEFAULT_FIRE_HOUR = 6;
export const DEFAULT_FIRE_MINUTE = 0;

/** Per FOUNDER_LOCKED §1 — 18:00–06:00 universal quiet window. */
export const QUIET_HOURS_START = '18:00';
export const QUIET_HOURS_END = '06:00';

/** Maximum allowed length of the coaching nudge body (§6 of spec). */
export const MAX_NUDGE_WORDS = 180;

/** Sentinel tenant_id used by platform-shipped seed KPI templates. */
export const SEED_TENANT_ID = '__seed__';

/** Hard cap for the supervisor-tier redacted summary. Per spec §5. */
export const SUPERVISOR_TIER_SENTENCE_CAP = 2;

// ---------------------------------------------------------------------------
// Roles + tiers + channels
// ---------------------------------------------------------------------------

export const ROLE_KEYS = [
  'foreman',
  'geologist',
  'driver',
  'accountant',
  'owner',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const KPI_DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'binary_target',
] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];

export const RECIPIENT_TIERS = ['subject', 'supervisor', 'owner'] as const;
export type RecipientTier = (typeof RECIPIENT_TIERS)[number];

export const NUDGE_CHANNELS = ['inapp', 'email', 'whatsapp'] as const;
export type NudgeChannel = (typeof NUDGE_CHANNELS)[number];

/** Canonical 5-band scale per spec §4. */
export const KPI_BANDS = [0, 0.4, 0.7, 0.9, 1.0] as const;
export type KpiBand = (typeof KPI_BANDS)[number];

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Kpi {
  readonly id: string;
  readonly label: string;
  /** Target value (numeric) the measure_fn should hit. */
  readonly target: number;
  /** Contribution weight in [0, 1]; per-template weights MUST sum to 1.0. */
  readonly weight: number;
  /** Name in the measurement registry that returns the raw value. */
  readonly measure_fn_name: string;
  readonly direction: KpiDirection;
}

export interface RoleKpiTemplate {
  readonly id: string;
  readonly tenant_id: string;
  readonly role: RoleKey | string;
  readonly kpi_definitions: ReadonlyArray<Kpi>;
  readonly audit_hash: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface KpiResult {
  readonly kpi_id: string;
  readonly raw: number;
  readonly band: number;
  readonly contribution: number;
}

export interface EmployeeScorecard {
  readonly id: string;
  readonly tenant_id: string;
  readonly employee_user_id: string;
  /** ISO date string `YYYY-MM-DD` covering the previous workday. */
  readonly date: string;
  readonly role: RoleKey | string;
  readonly kpis: ReadonlyArray<KpiResult>;
  /** Sum of contributions, clamped to [0, 1]. */
  readonly overall_score: number;
  /** Per-anomaly signals (NLP, drift, streak) discovered by the scorer. */
  readonly signals: Readonly<Record<string, unknown>>;
  readonly prev_hash: string;
  readonly audit_hash: string;
  readonly created_at: string;
}

export interface TieredView {
  readonly tier: RecipientTier;
  readonly counts: { readonly kpis_total: number; readonly kpis_at_or_above: number };
  /** Streak count of consecutive on-target days. */
  readonly streak_days: number;
  /** Renderable body — full text / 2-sentence redacted / empty for owner. */
  readonly body: string;
  /** Owner-tier aggregate stats; populated only for the owner view. */
  readonly aggregate?: AggregateOwnerStats;
}

export interface AggregateOwnerStats {
  readonly n_employees: number;
  readonly mean_score: number;
  readonly n_below_target: number;
  readonly n_exceeded: number;
  readonly top_signals: ReadonlyArray<string>;
}

export interface PerfNudge {
  readonly id: string;
  readonly tenant_id: string;
  readonly scorecard_id: string;
  readonly recipient_user_id: string;
  readonly recipient_tier: RecipientTier;
  readonly content: string;
  readonly channel: NudgeChannel;
  readonly sent_at: string | null;
  readonly audit_hash: string;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------
// Ports — host-owned interfaces (no I/O in this package).
// ---------------------------------------------------------------------------

export interface ScorecardRepository {
  insert(card: EmployeeScorecard): Promise<void>;
  findByDate(
    tenant_id: string,
    employee_user_id: string,
    date: string,
  ): Promise<EmployeeScorecard | null>;
  listForDate(
    tenant_id: string,
    date: string,
  ): Promise<ReadonlyArray<EmployeeScorecard>>;
  /** Returns the most-recent prior scorecard or `null`. Used for chain. */
  latestPrior(
    tenant_id: string,
    employee_user_id: string,
    before_date: string,
  ): Promise<EmployeeScorecard | null>;
}

export interface KpiTemplateRepository {
  upsert(template: RoleKpiTemplate): Promise<void>;
  get(
    tenant_id: string,
    role: string,
  ): Promise<RoleKpiTemplate | null>;
  list(tenant_id: string): Promise<ReadonlyArray<RoleKpiTemplate>>;
}

export interface PerfNudgeRepository {
  insert(nudge: PerfNudge): Promise<void>;
  listForScorecard(scorecard_id: string): Promise<ReadonlyArray<PerfNudge>>;
  markSent(id: string, sent_at: Date): Promise<void>;
}

/** Raw KPI measurement port — production wires reads against
 *  `@borjie/cognitive-memory` recall + `@borjie/capability-catalogue`
 *  invocation history. */
export interface KpiMeasurementPort {
  readonly measure: (input: KpiMeasurementInput) => Promise<number>;
}

export interface KpiMeasurementInput {
  readonly tenant_id: string;
  readonly employee_user_id: string;
  readonly date: string;
  readonly measure_fn_name: string;
}

/** Org-scope 1-up resolution port — production wires against
 *  `@borjie/org-scope` user-scope bindings. */
export interface OrgScopeResolver {
  /** Returns the supervisor user_id, or null at tenant root. */
  resolveDirectSupervisor(
    tenant_id: string,
    employee_user_id: string,
  ): Promise<string | null>;
  /** Returns the tenant owner user_id (root). */
  resolveOwner(tenant_id: string): Promise<string | null>;
}

/** Voice-mode read port — production wires against
 *  `@borjie/persona-voice` VoiceModeRepository. */
export interface VoiceModeReader {
  readMode(
    tenant_id: string,
    user_id: string,
  ): Promise<'guide' | 'learn' | 'balanced'>;
}

export interface AuditChainPort {
  append(payload: Readonly<Record<string, unknown>>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EmployeePerfFollowupError extends Error {
  public override readonly name = 'EmployeePerfFollowupError';
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas (for runtime validation at the host boundary)
// ---------------------------------------------------------------------------

export const kpiDirectionSchema = z.enum(KPI_DIRECTIONS);
export const recipientTierSchema = z.enum(RECIPIENT_TIERS);
export const nudgeChannelSchema = z.enum(NUDGE_CHANNELS);

export const kpiSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  target: z.number(),
  weight: z.number().min(0).max(1),
  measure_fn_name: z.string().min(1),
  direction: kpiDirectionSchema,
});

export const roleKpiTemplateInsertSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  role: z.string().min(1),
  kpi_definitions: z.array(kpiSchema).min(1),
});

export const employeeScorecardInsertSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  employee_user_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.string().min(1),
  kpis: z.array(
    z.object({
      kpi_id: z.string().min(1),
      raw: z.number(),
      band: z.number().min(0).max(1),
      contribution: z.number().min(0).max(1),
    }),
  ),
  overall_score: z.number().min(0).max(1),
  signals: z.record(z.string(), z.unknown()),
});

export const perfNudgeInsertSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  scorecard_id: z.string().uuid(),
  recipient_user_id: z.string().min(1),
  recipient_tier: recipientTierSchema,
  content: z.string(),
  channel: nudgeChannelSchema,
});
