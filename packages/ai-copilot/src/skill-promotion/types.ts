/**
 * Skill-promotion types — Voyager-style procedural-memory auto-promotion.
 *
 * Closes the §4.6 gap from `.planning/parity-litfin/00-STATUS-2026-05-18.md`:
 *
 *   "skill-registry.schema.ts is shipped but the auto-promotion path
 *    (procedural → skill) is not wired."
 *
 * Pipeline (pure, deterministic):
 *
 *   procedural traces[]
 *      → pattern-extractor (BFS over n-gram tool calls, n=2..5)
 *      → significance-gate (occurrences ≥ N AND success ≥ τ AND χ² p<0.05)
 *      → promoter (writes to skill registry via injected port; idempotent)
 *
 * Every type is `readonly` so callers can't mutate canonical fields by
 * accident. The pipeline never imports drizzle or any I/O — the registry
 * port (`SkillRegistryWriter`) is injected so the same code works in
 * unit tests, the consolidation worker, and an evaluation harness.
 *
 * Reference: Wang et al. 2023, "Voyager: An Open-Ended Embodied Agent with
 * LLMs" (arXiv 2305.16291).
 */

// ---------------------------------------------------------------------------
// Trace — single procedural execution we observed in production
// ---------------------------------------------------------------------------

/** Single tool invocation inside a trace. */
export interface ToolCall {
  readonly toolName: string;
  /**
   * Canonical input shape — keys + types, NOT raw values. The pattern
   * extractor only inspects `toolName`; the canonical-input shape is
   * passed through to `tool_call_template` once a skill is promoted so
   * the kernel can replay it. Default null when the caller can't (or
   * won't) summarise inputs.
   */
  readonly inputShape?: Readonly<Record<string, string>> | null;
}

/**
 * One observed procedural execution. The brain emits one of these per
 * completed sub-task (think "the agent reconciled an M-Pesa batch by
 * calling resolveContact → fetchLedger → postEntry"). Success comes
 * from the outcome-capture layer or a human-feedback signal.
 */
export interface ProceduralTrace {
  readonly traceId: string;
  /** Nullable for global skills (cross-tenant). */
  readonly tenantId: string | null;
  /** Ordered tool calls — order matters; n-gram extraction depends on it. */
  readonly toolSequence: readonly ToolCall[];
  /** Final outcome from the surrounding workflow. */
  readonly outcome: 'success' | 'failure';
  /** ISO-8601 — used only for breaking ties when ranking candidates. */
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------
// CandidateSkill — recurring n-gram with aggregated stats
// ---------------------------------------------------------------------------

/**
 * A recurring tool sub-sequence the extractor surfaced. `successCount`
 * and `failureCount` are pooled across all traces that contained this
 * exact sub-sequence (order-preserving, contiguous).
 */
export interface CandidateSkill {
  /** sha256(JSON(toolNames)) — stable de-dupe key across promote runs. */
  readonly codeHash: string;
  /** NULL = global. Mirrors `skill_registry.tenant_id`. */
  readonly tenantId: string | null;
  /** The contiguous tool sub-sequence (length 2..5). */
  readonly toolSequence: readonly ToolCall[];
  readonly occurrences: number;
  readonly successCount: number;
  readonly failureCount: number;
  /** First & last time the pattern was observed (ISO-8601). */
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

// ---------------------------------------------------------------------------
// PromotionDecision — what the gate produced for a single candidate
// ---------------------------------------------------------------------------

export type PromotionVerdict = 'promote' | 'reject';

export interface PromotionDecision {
  readonly candidate: CandidateSkill;
  readonly verdict: PromotionVerdict;
  /** Reason code — stable enum suitable for dashboards. */
  readonly reason:
    | 'occurrences_below_threshold'
    | 'success_rate_below_threshold'
    | 'chi_squared_not_significant'
    | 'significant';
  /** χ² statistic vs. a null model of uniform tool sequencing. */
  readonly chiSquared: number;
  /** χ² critical value (df=1, p=0.05) for inspection. */
  readonly chiSquaredCritical: 3.841;
  readonly successRate: number;
}

// ---------------------------------------------------------------------------
// SkillRegistryWriter — injected port; production impl is the Drizzle
// service in `packages/database` keyed off `skill_registry.schema.ts`.
// ---------------------------------------------------------------------------

export interface PromotionRecord {
  /** NULL = global. */
  readonly tenantId: string | null;
  /** Stable name derived from tool-name sequence. Audit-log surface. */
  readonly name: string;
  /** Natural-language description — feeds the retrieval embedding. */
  readonly nlDescription: string;
  /** sha256 from `CandidateSkill.codeHash` — registry unique key. */
  readonly codeHash: string;
  /** Replayed verbatim by the kernel. */
  readonly toolCallTemplate: Readonly<Record<string, unknown>>;
  readonly initialSuccessCount: number;
  readonly initialFailureCount: number;
}

/**
 * Minimal port — only the operations the promoter needs. The Drizzle
 * implementation uses `INSERT … ON CONFLICT (tenant_id, code_hash)
 * DO UPDATE SET success_count = success_count + EXCLUDED.success_count,
 * failure_count = failure_count + EXCLUDED.failure_count` so a re-promote
 * on the same candidate is a counter-bump, never a duplicate row.
 */
export interface SkillRegistryWriter {
  /** Returns true iff the record was newly inserted (false ⇒ counter-bump). */
  upsertSkill(record: PromotionRecord): Promise<boolean>;
  /** Lookup by (tenantId, codeHash). Used to keep `promote()` idempotent. */
  findByCodeHash(
    tenantId: string | null,
    codeHash: string,
  ): Promise<PromotionRecord | null>;
}

// ---------------------------------------------------------------------------
// Thresholds — Voyager defaults, exposed for tuning
// ---------------------------------------------------------------------------

/** Minimum distinct observations to consider promotion. */
export const MIN_OCCURRENCES = 5 as const;

/** Minimum pooled success rate (0..1) for a candidate to be promoted. */
export const MIN_SUCCESS_RATE = 0.85 as const;

/**
 * χ² critical value (df=1, p=0.05). Same constant as `learning-loop`.
 * Re-exported here so this module has no cross-package coupling.
 */
export const CHI_SQUARED_CRITICAL_95 = 3.841 as const;

/** Smallest n-gram window the extractor considers (≥2 — a single call is not a "skill"). */
export const MIN_NGRAM = 2 as const;

/** Largest n-gram window the extractor considers. */
export const MAX_NGRAM = 5 as const;
