/**
 * Research-tools — shared types.
 *
 * The Deep Research engine plans (Planner) → executes tools (Executor)
 * → scores artifacts (Scorer) → synthesises a result (Synthesizer) →
 * appends to the audit chain (Audit-chain emitter). This file pins the
 * canonical contracts each component reads / writes.
 *
 * All types are `readonly` per the project immutability rule — no
 * mutation between stages. See `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` §6.
 *
 * Pure types + zod schemas. No I/O. Safe from any tier.
 *
 * @module @borjie/research-tools/types
 */

import { z } from 'zod';

// ===========================================================================
// Mode + tool enums (mirror the DDL in §14 of the spec)
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

/**
 * The 9-class quality rubric. Used by the Scorer to seed the base score
 * before recency / corroboration / internal-consistency modifiers apply.
 */
export const SOURCE_CLASSES = [
  'tz_official', // .gov.tz, gazette, regulator                  base 0.95
  'tier1_market', // LME, Kitco, Bloomberg, Reuters                base 0.90
  'academic', // peer-reviewed                                  base 0.85
  'corporate_filing', // 10-K, prospectus, annual report           base 0.85
  'established_news', // BBC, FT, Mining Weekly                    base 0.75
  'trade_press', // industry trade journals                       base 0.70
  'forum', // forums / social                                     base 0.30
  'generic_blog', // unknown / generic blogs                        base 0.20
  'ai_generated', // detected AI content                            base 0.10
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/**
 * Bias / quality flags the Scorer attaches. The Synthesizer must
 * propagate any non-empty flag set into the rendered citation chip so
 * the owner sees the warning.
 */
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
  kind: z.enum([
    'person',
    'organization',
    'location',
    'commodity',
    'regulator',
    'licence',
    'monetary',
    'date',
    'percentage',
    'unknown',
  ]),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Entity = z.infer<typeof EntitySchema>;

// ===========================================================================
// SpanCitation — shared with packages/ai-copilot/src/retrieval
// ===========================================================================

/**
 * Character-offset span citation for downstream UI highlighting. Mirrors
 * the shape used by `packages/ai-copilot/src/retrieval/span-citations.ts`
 * but extended with `kind: 'web' | 'corpus' | 'feed'` per spec §8.
 */
export const SpanCitationSchema = z.object({
  citationId: z.string().min(1),
  kind: z.enum(['web', 'corpus', 'feed', 'pdf', 'image', 'table']),
  sourceUri: z.string().min(1),
  chunkId: z.string().optional(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  quotedSpan: z.string().min(1),
  overlap: z.number().min(0).max(1),
});
export type SpanCitation = z.infer<typeof SpanCitationSchema>;

// ===========================================================================
// ResearchArtifact (§6 of the spec)
// ===========================================================================

export const ResearchArtifactSchema = z.object({
  id: z.string().min(1),
  step_id: z.string().min(1),
  source_kind: z.enum(SOURCE_KINDS),
  source_uri: z.string().min(1),
  source_class: z.enum(SOURCE_CLASSES),
  retrieved_at: z.string().min(1), // ISO 8601
  content: z.string(),
  excerpt: z.string().max(2_000), // short blurb for citation chips
  title: z.string().max(500),
  extracted_entities: z.array(EntitySchema).readonly(),
  quality_score: z.number().min(0).max(1),
  bias_flags: z.array(z.enum(BIAS_FLAGS)).readonly(),
  citation_id: z.string().min(1),
  audit_hash: z.string().min(1), // sha256 of canonical-JSON({uri, content, retrieved_at})
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
  status: z.enum(['pending', 'running', 'done', 'failed']),
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
  created_by: z.enum(['mr_mwikila', 'owner_explicit']),
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
// ToolAdapter contract
// ===========================================================================

/**
 * Authority tier — Tier 0 means "read-only, no side effects to the
 * outside world". Every research tool is Tier 0 by definition; writes
 * happen in the orchestrator service, not here.
 */
export type AuthorityTier = 0;

/**
 * Per-adapter cost meta. `cost_per_call_usd_cents` is the budget
 * envelope estimate the executor uses to decide whether the call is
 * affordable. Adapters may report a more precise actual cost back in
 * the returned artifact's `cost_usd_cents` field.
 */
export interface ToolCostMeta {
  readonly cost_per_call_usd_cents: number;
}

/**
 * Adapter-local cache lifetimes (seconds). Honoured by the cache layer.
 */
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
  /**
   * Returns ResearchArtifact[]. MUST set quality_score in [0,1] (via
   * the scorer), citation_id, audit_hash. MAY return [] on missing env
   * keys / soft errors — never throws on a recoverable adapter outage.
   */
  invoke(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

// ===========================================================================
// ToolContext — passed into every adapter invocation
// ===========================================================================

/**
 * Minimal cache surface — TTL aware, async, opaque value. Adapters
 * SHOULD short-circuit if `await cache.get(key)` hits.
 */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Cost-tracker surface. Adapters call `tryReserve` BEFORE the network
 * call; the tracker returns false if the reservation would exceed the
 * plan's budget envelope. On success the adapter calls `commit` with
 * the actual measured cost (which may be less than reserved).
 */
export interface CostTracker {
  /** Reserve `estimated_cents` against the plan's budget. Returns true
   *  on success, false when the reservation would exceed the budget. */
  tryReserve(estimated_cents: number): Promise<boolean>;
  /** Commit a measured cost. MUST be called after a successful network
   *  call so the tracker can release any over-reservation. */
  commit(measured_cents: number): Promise<void>;
  /** Release a reservation without committing — call on adapter
   *  failure so the budget isn't leaked. */
  release(reserved_cents: number): Promise<void>;
  /** Read-only snapshot of total spend. */
  spent(): Promise<number>;
  /** Read-only snapshot of the budget envelope. */
  budget(): number;
}

/**
 * Owner-confirmation gate. Deep-dive budgets pause at $5 / $15 spent so
 * the owner can reconfirm or stop. The orchestrator wires a real
 * implementation; adapters consume it as an opaque check.
 */
export interface OwnerConfirmGate {
  /** Returns true if the current spend has crossed a gate that has not
   *  yet been acknowledged. Adapters that see `true` MUST refuse to
   *  call. */
  needsConfirm(currentSpend: number): boolean;
}

export interface ToolContext {
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly step_id: string;
  readonly cache: Cache;
  readonly cost_tracker: CostTracker;
  readonly owner_confirm?: OwnerConfirmGate;
  /** Optional fetch override so callers (tests, sandboxed tiers) can
   *  inject a deterministic transport. */
  readonly fetchImpl?: typeof fetch;
  /** Optional logger hook — defaults to noop when unset. */
  readonly logger?: ResearchLogger;
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
