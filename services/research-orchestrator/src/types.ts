/**
 * @borjie/research-orchestrator — canonical contracts.
 *
 * The Deep Research engine's contracts (ResearchPlan, ResearchStep,
 * ResearchArtifact, ResearchResult, ToolAdapter, …) are defined here
 * to match `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` §6 verbatim. Once the
 * sibling `@borjie/research-tools` package ships its public barrel,
 * the orchestrator can switch to re-exporting from there — this file
 * is the SINGLE choke-point for that swap.
 *
 * Every type is `readonly` per the project immutability rule — no
 * mutation between Planner → Executor → Scorer → Synthesizer.
 *
 * @module research-orchestrator/types
 */

import { z } from 'zod';

// ===========================================================================
// Mode + tool enums (§3 + §6 of the spec)
// ===========================================================================

export const RESEARCH_MODES = [
  'reactive_query',
  'anticipatory_sweep',
  'daily_briefing',
  'deep_dive',
  'continuous_watch',
] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const RESEARCH_TOOLS = [
  'web_search',
  'web_fetch',
  'corpus_query',
  'commodity_price',
  'regulatory_diff',
  'news_scan',
  'pdf_extract',
  'image_ocr',
  'image_vision',
  'table_parse',
  'fx_rate',
] as const;
export type ResearchTool = (typeof RESEARCH_TOOLS)[number];

export const SOURCE_KINDS = [
  'web',
  'corpus',
  'feed',
  'pdf',
  'image',
  'table',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

// ===========================================================================
// Source classification + bias flags (§7 of the spec)
// ===========================================================================

export const SOURCE_CLASSES = [
  'tz_official',
  'tier1_market',
  'academic',
  'corporate_filing',
  'established_news',
  'trade_press',
  'forum',
  'generic_blog',
  'ai_generated',
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export const BIAS_FLAGS = [
  'opinion',
  'paid_promotion',
  'unverified',
  'ai_generated',
  'sponsored',
  'press_release',
  'syndicated',
  'low_authority',
  'stale',
] as const;
export type BiasFlag = (typeof BIAS_FLAGS)[number];

// ===========================================================================
// Entity (extracted from artifact content)
// ===========================================================================

export const EntitySchema = z.object({
  kind: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
  span_start: z.number().int().nonnegative().optional(),
  span_end: z.number().int().nonnegative().optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

// ===========================================================================
// Span citation (§8 of the spec)
// ===========================================================================

export const SpanCitationSchema = z.object({
  citation_id: z.string().min(1),
  source_uri: z.string().min(1),
  kind: z.enum(['web', 'corpus', 'feed', 'pdf']),
  quoted_span: z.string().min(1),
  start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().nonnegative(),
  overlap: z.number().min(0).max(1).optional(),
});
export type SpanCitation = z.infer<typeof SpanCitationSchema>;

// ===========================================================================
// ResearchArtifact (§6)
// ===========================================================================

export const ResearchArtifactSchema = z.object({
  id: z.string().min(1),
  step_id: z.string().min(1),
  source_kind: z.enum(SOURCE_KINDS),
  source_uri: z.string().min(1),
  source_class: z.enum(SOURCE_CLASSES),
  retrieved_at: z.string().min(1),
  content: z.string(),
  excerpt: z.string().max(2_000),
  title: z.string().max(500),
  extracted_entities: z.array(EntitySchema).readonly(),
  quality_score: z.number().min(0).max(1),
  bias_flags: z.array(z.enum(BIAS_FLAGS)).readonly(),
  citation_id: z.string().min(1),
  audit_hash: z.string().min(1),
  tool_name: z.string().min(1),
  cost_usd_cents: z.number().nonnegative(),
});
export type ResearchArtifact = z.infer<typeof ResearchArtifactSchema>;

// ===========================================================================
// ResearchStep (§6)
// ===========================================================================

export const ResearchStepSchema = z.object({
  id: z.string().min(1),
  plan_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  tool: z.enum(RESEARCH_TOOLS),
  tool_input: z.record(z.unknown()),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  artifact_ids: z.array(z.string()).readonly(),
  cost_usd_cents: z.number().nullable(),
  duration_ms: z.number().nullable(),
});
export type ResearchStep = z.infer<typeof ResearchStepSchema>;

// ===========================================================================
// ResearchPlan (§6)
// ===========================================================================

export const ResearchPlanSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  mode: z.enum(RESEARCH_MODES),
  query: z.string().min(1),
  created_by: z.enum(['mr_mwikila', 'owner_explicit', 'worker_cron']),
  created_at: z.string().min(1),
  budget_ms: z.number().int().positive(),
  budget_usd_cents: z.number().int().nonnegative(),
  steps: z.array(ResearchStepSchema).readonly(),
  status: z.enum(['planned', 'running', 'paused', 'complete', 'failed']),
  result_id: z.string().nullable(),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// ===========================================================================
// ResearchResult (§6)
// ===========================================================================

export const ResearchResultSchema = z.object({
  id: z.string().min(1),
  plan_id: z.string().min(1),
  summary_md: z.string().min(1),
  span_citations: z.array(SpanCitationSchema).readonly(),
  confidence: z.enum(['high', 'medium', 'low']),
  disagreements: z
    .array(
      z.object({
        topic: z.string().min(1),
        sources: z.array(z.string().min(1)).readonly(),
      }),
    )
    .readonly(),
  audit_hash: z.string().min(1),
  generated_at: z.string().min(1),
  total_cost_usd_cents: z.number().nonnegative(),
  total_duration_ms: z.number().nonnegative(),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ===========================================================================
// Adapter contract — every research tool implements this
// ===========================================================================

export type AuthorityTier = 0;

export interface ToolCostMeta {
  readonly cost_per_call_usd_cents: number;
}

export interface CacheTtlSeconds {
  readonly default_ttl_s: number;
}

export interface ToolAdapter<
  TInput,
  TOutput extends ReadonlyArray<ResearchArtifact>,
> {
  readonly name: string;
  readonly version: string;
  readonly authority_tier: AuthorityTier;
  readonly cost_per_call_usd_cents: number;
  invoke(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

// ===========================================================================
// Cache + cost tracker + owner-confirm gate
// ===========================================================================

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface CostTracker {
  tryReserve(estimated_cents: number): Promise<boolean>;
  commit(measured_cents: number): Promise<void>;
  release(reserved_cents: number): Promise<void>;
  spent(): Promise<number>;
  budget(): number;
}

export interface OwnerConfirmGate {
  needsConfirm(currentSpendCents: number): boolean;
}

export interface ResearchLogger {
  warn(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  info(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  error(msg: string, meta?: Readonly<Record<string, unknown>>): void;
}

export const NOOP_LOGGER: ResearchLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
};

export interface ToolContext {
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly step_id: string;
  readonly cache: Cache;
  readonly cost_tracker: CostTracker;
  readonly owner_confirm?: OwnerConfirmGate;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: ResearchLogger;
}

// ===========================================================================
// Orchestrator-local types
// ===========================================================================

/**
 * Per-mode budget envelope. Lifted from §9 of DEEP_RESEARCH_SPEC.
 * Each mode has hard latency + cost ceilings; the budget gate refuses
 * to start a plan whose ceilings exceed these defaults.
 */
export interface ModeBudget {
  readonly latency_ms: number;
  readonly cost_usd_cents: number;
  /** Owner-confirm gates in USD dollars (deep-dive: [5, 15]). */
  readonly owner_confirm_gates_usd?: ReadonlyArray<number>;
}

/**
 * Briefing row written to `master_brain_briefings` table. Created by
 * the Daily Briefing mode at 06:00 owner-local time.
 */
export interface DailyBriefingRow {
  readonly tenant_id: string;
  readonly summary_md: string;
  readonly evidence_ids: ReadonlyArray<string>;
  readonly actions_proposed: ReadonlyArray<Record<string, unknown>>;
  readonly status: 'draft' | 'final' | 'superseded';
}

/**
 * Notification event emitted when a briefing or a continuous-watch
 * threshold crosses. Consumed by `services/notifications/`.
 */
export interface ResearchNotificationEvent {
  readonly kind:
    | 'daily_briefing_ready'
    | 'watch_threshold_crossed'
    | 'deep_dive_gate_reached';
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly result_id?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Worker logger used across orchestrator modules — same shape as the
 * sibling workers so observability hooks can be reused.
 */
export interface OrchestratorLogger {
  info(obj: Readonly<Record<string, unknown>>, msg?: string): void;
  warn(obj: Readonly<Record<string, unknown>>, msg?: string): void;
  error(obj: Readonly<Record<string, unknown>>, msg?: string): void;
}

/**
 * Shape of a tenant row the cron iterates over for daily briefings.
 */
export interface BriefingTenant {
  readonly tenantId: string;
  readonly timezone: string;
  readonly locale: string;
}

/**
 * Shape of a continuous-watch row that's due for a poll.
 */
export interface DueWatch {
  readonly id: string;
  readonly tenantId: string;
  readonly topic: string;
  readonly cadenceMinutes: number;
  readonly thresholds: Readonly<Record<string, unknown>>;
  readonly lastRunAt: string | null;
}
