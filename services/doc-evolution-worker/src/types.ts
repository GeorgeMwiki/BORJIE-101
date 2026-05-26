/**
 * doc-evolution-worker — shared contracts.
 *
 * Layer 4 of Document Composition (Wave 17D). The worker walks
 * `doc_feedback_events`, computes 60-day fitness per recipe, makes
 * lock/improve decisions, generates LLM-backed improvement proposals,
 * and emits Tier-2 owner-approval cards for pending document artifacts.
 *
 * The types defined here mirror — but do not import — the contracts in
 * `packages/document-templates/src/types.ts`. The package is partially
 * built today (only brand-lock is wired through its public exports);
 * defining the shapes locally keeps this service compilable while still
 * being a faithful Wave 17D Layer-4 consumer per the spec.
 *
 * All shapes are immutable per `~/.claude/rules/coding-style.md`.
 */

// ---------------------------------------------------------------------------
// Document-composition domain mirror (spec §3, §11).
// ---------------------------------------------------------------------------

export type DocumentClass =
  | 'daily_briefing'
  | 'board_report'
  | 'investor_briefing'
  | 'tumemadini_return'
  | 'nemc_filing'
  | 'buyer_kyb_pack'
  | 'sop'
  | 'financial_model'
  | 'contract'
  | 'geological_report'
  | 'marketplace_listing';

export type DocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'md' | 'html';

export type RecipeStatus = 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';

export type AuthorityTier = 0 | 1 | 2;

export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'auto_published';

export type FeedbackKind =
  | 'accepted'
  | 'revised'
  | 'rejected'
  | 'regulator_flag'
  | 'owner_rewrite'
  | 'time_to_approve'
  | 'submit_failure';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

// ---------------------------------------------------------------------------
// Recipe + artifact + feedback rows (matches migration 0019).
// ---------------------------------------------------------------------------

export interface DocumentRecipeRow {
  readonly id: string;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly class: DocumentClass;
  readonly compose_fn_ref: string;
  readonly required_inputs: ReadonlyArray<unknown>;
  readonly required_citations: ReadonlyArray<unknown>;
  readonly output_formats: ReadonlyArray<DocumentFormat>;
  readonly authority_tier: AuthorityTier;
  readonly brand: 'borjie';
  readonly approval_required: boolean;
  readonly promoted_at: string | null;
  readonly promoted_by: string | null;
  readonly locked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DocumentArtifactRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly format: DocumentFormat;
  readonly storage_key: string;
  readonly checksum: string;
  readonly span_citations: ReadonlyArray<unknown>;
  readonly audit_hash: string;
  readonly approval_state: ApprovalState;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly generated_at: string;
}

export interface DocFeedbackEventRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly tenant_id: string;
  readonly feedback_kind: FeedbackKind;
  readonly section_path: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly recorded_at: string;
}

export interface DocEvolutionProposalRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly current_version: number;
  readonly proposed_version: number;
  readonly proposed_diff: ProposedDiff;
  readonly signals: Readonly<Record<string, unknown>>;
  readonly citations: ReadonlyArray<string>;
  readonly status: ProposalStatus;
  readonly proposed_at: string;
  readonly reviewed_at: string | null;
  readonly reviewed_by: string | null;
  readonly reviewer_reason: string | null;
  readonly approval_audit_hash: string | null;
}

// ---------------------------------------------------------------------------
// Worker-internal contracts.
// ---------------------------------------------------------------------------

/**
 * 60-day rolling stats per recipe id+version.
 *
 * `first_submit_acceptance_rate`  — first-submit acceptances /
 *                                   compositions in window.
 * `revision_rate`                 — revised feedback / compositions.
 * `regulator_flag_count`          — regulator_flag feedback in window.
 * `composition_count`             — total compositions in window.
 * `section_revision_rates`        — per `section_path` revision %.
 */
export interface RecipeFitnessStats {
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly tenant_id: string;
  readonly window_start_iso: string;
  readonly window_end_iso: string;
  readonly composition_count: number;
  readonly first_submit_acceptance_rate: number;
  readonly revision_rate: number;
  readonly regulator_flag_count: number;
  readonly owner_rewrite_count: number;
  readonly avg_time_to_approve_seconds: number | null;
  readonly section_revision_rates: ReadonlyArray<SectionRevisionRate>;
}

export interface SectionRevisionRate {
  readonly section_path: string;
  readonly revision_rate: number;
  readonly revision_count: number;
}

/**
 * Composite fitness score in [0..1]. Computed by `fitness-scorer.ts`.
 */
export interface RecipeFitnessScore {
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly tenant_id: string;
  readonly score: number;
  readonly components: {
    readonly acceptance_component: number;
    readonly revision_component: number;
    readonly regulator_component: number;
  };
}

/**
 * Lock decision outcome — emitted by `lock-decision.ts`.
 */
export type LockDecision =
  | { readonly kind: 'lock_candidate'; readonly reasons: ReadonlyArray<string> }
  | { readonly kind: 'lock'; readonly reasons: ReadonlyArray<string> }
  | { readonly kind: 'hold'; readonly reasons: ReadonlyArray<string> };

/**
 * Improve decision outcome — emitted by `improve-decision.ts`.
 */
export type ImproveDecision =
  | { readonly kind: 'improve'; readonly reasons: ReadonlyArray<string> }
  | { readonly kind: 'hold'; readonly reasons: ReadonlyArray<string> };

/**
 * Section-level diff produced by the LLM proposal generator.
 * Each entry is a structural edit; the union is intentionally narrow.
 */
export type SectionEditKind =
  | 'rewrite'
  | 'reorder'
  | 'add_citation'
  | 'remove_section'
  | 'add_section';

export interface SectionEdit {
  readonly kind: SectionEditKind;
  readonly section_path: string;
  readonly rationale: string;
  readonly proposed_text?: string | undefined;
  readonly proposed_position?: number | undefined;
  readonly citation_ref?: string | undefined;
}

export interface ProposedDiff {
  readonly recipe_id: string;
  readonly current_version: number;
  readonly proposed_version: number;
  readonly edits: ReadonlyArray<SectionEdit>;
  readonly summary: string;
}

/**
 * Tier-2 approval card the worker emits onto the owner-facing queue.
 */
export interface Tier2ApprovalCard {
  readonly artifact_id: string;
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly recipe_class: DocumentClass;
  readonly format: DocumentFormat;
  readonly storage_key: string;
  readonly checksum: string;
  readonly generated_at: string;
}

/**
 * Lightweight logger compatible with the brain-evolution-worker and
 * proactive-triggers-worker shapes.
 */
export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Aggregate counters returned from a nightly aggregation run.
 */
export interface NightlyAggregationSummary {
  readonly window_start_iso: string;
  readonly window_end_iso: string;
  readonly recipes_scanned: number;
  readonly lock_decisions: number;
  readonly improve_decisions: number;
  readonly proposals_emitted: number;
  readonly tier2_cards_emitted: number;
  readonly errored: number;
}
