/**
 * `@borjie/ui-evolution-worker` — shared types.
 *
 * Source of truth: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §4 (Lock-vs-
 * Improve Policy) and §5 (Human-in-the-Loop Approval Flow).
 *
 * Layer 4 of the Anticipatory UX architecture:
 *
 *   1. Daily aggregator walks `ui_telemetry_events` for every live
 *      `tab_recipes` row, computes per-recipe rolling-window metrics.
 *   2. Decision engine applies the policy table from spec §4 to
 *      classify each (recipe, version) as `lock_candidate`,
 *      `improve_candidate`, or `neutral`.
 *   3. Proposal generator drafts a structured diff (LLM-driven via
 *      `@borjie/brain-llm-router` cost cascade) bounded to Tier-1
 *      changes.
 *   4. Owner-approval proposal emitter writes to `ui_evolution_
 *      proposals` and emits a notification event.
 *   5. Promotion state machine flips recipe versions and writes
 *      tamper-evident audit-hash-chain entries.
 *
 * All collections are `ReadonlyArray<T>`; all objects are `Readonly`
 * so the worker pipeline operates by returning NEW structures rather
 * than mutating in-place — see ~/.claude/rules/coding-style.md.
 */

// ---------------------------------------------------------------------------
// Domain primitives — mirror DDL `tab_recipes.status` + `ui_evolution_
// proposals.status` from migration 0017.
// ---------------------------------------------------------------------------

/** Lifecycle status of a Tab Recipe version. */
export type TabRecipeStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

/** Authority tier — §5 of the spec. */
export type AuthorityTier = 0 | 1 | 2;

/** Proposal status enum — exactly as defined in migration 0017. */
export type ProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'auto_applied_tier_0';

/** Rollout strategies the owner can pick when approving a proposal. */
export type RolloutStrategy = 'gradual' | 'full' | 'a_b';

/** Decision the fitness scorer emits for a single (recipe, version). */
export type FitnessDecision =
  | 'lock_candidate'
  | 'improve_candidate'
  | 'neutral';

/** Telemetry event kind — must match the CHECK constraint on
 *  `ui_telemetry_events.event_kind`. */
export type EventKind =
  | 'focus'
  | 'blur'
  | 'change'
  | 'error'
  | 'tooltip_hit'
  | 'abandon'
  | 'submit'
  | 'render'
  | 'dismiss';

// ---------------------------------------------------------------------------
// Logger — duck-typed pino/structured shape so we don't pull pino into
// every test fixture. Production wires `@borjie/observability` Logger.
// ---------------------------------------------------------------------------

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Telemetry events + aggregation
// ---------------------------------------------------------------------------

/** One row pulled from `ui_telemetry_events`. */
export interface TelemetryEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly sessionId: string | null;
  readonly fieldId: string | null;
  readonly eventKind: EventKind;
  readonly recordedAt: string; // ISO 8601
}

/** Per-field metrics inside a recipe window. */
export interface FieldMetrics {
  readonly fieldId: string;
  readonly focusCount: number;
  readonly errorCount: number;
  readonly blurWithoutSubmitCount: number;
  readonly tooltipHitCount: number;
  /** error_count / focus_count. 0 when focus_count == 0. */
  readonly errorRate: number;
  /** blur_without_submit / focus_count. 0 when focus_count == 0. */
  readonly abandonmentRate: number;
  /** tooltip_hit / focus_count. 0 when focus_count == 0. */
  readonly tooltipHitRate: number;
}

/** Per-recipe-version aggregation over a single rolling window. */
export interface RecipeMetrics {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
  /** Total `render` events in the window — distinct tab presentations. */
  readonly renderCount: number;
  /** Total `submit` events in the window — distinct completions. */
  readonly submitCount: number;
  /** submit / render. 0 when render == 0. */
  readonly completionRate: number;
  /** Average `error` rate across all per-field metrics. 0 when no fields. */
  readonly errorRate: number;
  /** Max blur-without-submit rate across all per-field metrics. */
  readonly maxFieldAbandonmentRate: number;
  readonly fields: ReadonlyArray<FieldMetrics>;
}

/** Composite fitness output for a single recipe-version. */
export interface FitnessReport {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly score: number; // [0..1]
  readonly decision: FitnessDecision;
  /** When `decision === 'improve_candidate'`, the precise signals that
   *  pushed it over the line — surfaced into the proposal for owner UX. */
  readonly failingSignals: ReadonlyArray<FailingSignal>;
  /** When `decision === 'lock_candidate'`, the passing thresholds in
   *  human-readable form. */
  readonly passingSignals: ReadonlyArray<string>;
  /** Metrics that produced the score — passed forward to proposals. */
  readonly metrics: RecipeMetrics;
}

/** One failing signal — feeds into the proposal generator's LLM prompt
 *  AND into the proposal `signals` JSON column. */
export interface FailingSignal {
  readonly kind:
    | 'low_completion'
    | 'high_field_error'
    | 'high_field_abandonment'
    | 'high_tooltip_hit';
  readonly fieldId?: string;
  readonly value: number; // the offending metric
  readonly threshold: number; // the policy threshold that was breached
  readonly humanReadable: string; // for the proposal UI
}

// ---------------------------------------------------------------------------
// Lock / improve decisions
// ---------------------------------------------------------------------------

/** Outcome of the §4 decision table after combining the 14-day window
 *  with the 60-day sustained-pass tracking. */
export interface LockDecision {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly action: 'mark_lock_candidate' | 'lock' | 'noop';
  readonly reason: string;
}

/** Outcome of the improve-decision branch. */
export interface ImproveDecision {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly action: 'propose_improvement' | 'noop';
  readonly reason: string;
  readonly failingSignals: ReadonlyArray<FailingSignal>;
}

// ---------------------------------------------------------------------------
// Proposal generation
// ---------------------------------------------------------------------------

/** A single change in the proposed_schema_diff. The shape is loose on
 *  purpose — the owner UI renders it as a structured diff via the
 *  existing `diff-view` UiPart. */
export type ProposedDiffOp =
  | { readonly op: 'reorder_fields'; readonly groupId: string; readonly fieldIdsBefore: ReadonlyArray<string>; readonly fieldIdsAfter: ReadonlyArray<string> }
  | { readonly op: 'regroup_field'; readonly fieldId: string; readonly fromGroupId: string; readonly toGroupId: string }
  | { readonly op: 'split_step'; readonly groupId: string; readonly intoGroupIds: ReadonlyArray<string> }
  | { readonly op: 'add_help_copy'; readonly fieldId: string; readonly helpEn: string; readonly helpSw: string; readonly citationId: string }
  | { readonly op: 'rename_label'; readonly fieldId: string; readonly labelEnBefore: string; readonly labelEnAfter: string; readonly labelSwBefore: string; readonly labelSwAfter: string };

/** The structured diff persisted to `ui_evolution_proposals.proposed_schema_diff`. */
export interface ProposedDiff {
  readonly ops: ReadonlyArray<ProposedDiffOp>;
  /** Free-text rationale composed by the LLM — surfaced as "Why this change?". */
  readonly rationaleEn: string;
  readonly rationaleSw: string;
}

/** One proposal as it lands in the database. */
export interface EvolutionProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly tabRecipeId: string;
  readonly currentVersion: number;
  readonly proposedVersion: number;
  readonly proposedSchemaDiff: ProposedDiff;
  readonly signals: ReadonlyArray<FailingSignal>;
  readonly citations: ReadonlyArray<string>;
  readonly status: ProposalStatus;
  readonly proposedAtIso: string;
  readonly reviewedAtIso?: string;
  readonly reviewedBy?: string;
  readonly reviewerReason?: string;
  readonly rolloutStrategy?: RolloutStrategy;
  readonly approvalAuditHash?: string;
}

// ---------------------------------------------------------------------------
// Tab Recipe surface — mirror the `tab_recipes` row used by the worker.
// ---------------------------------------------------------------------------

export interface TabRecipeRow {
  readonly id: string;
  readonly version: number;
  readonly status: TabRecipeStatus;
  readonly intent: string;
  readonly composeFnRef: string;
  readonly authorityTier: AuthorityTier;
  readonly brand: 'borjie';
  readonly promotedAtIso: string | null;
  readonly promotedBy: string | null;
  readonly lockedAtIso: string | null;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

// ---------------------------------------------------------------------------
// Cron summary
// ---------------------------------------------------------------------------

/** Per-recipe per-tenant outcome rolled up from the nightly cron. */
export interface RecipeSweepResult {
  readonly tenantId: string;
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly status: 'ok' | 'skipped' | 'error';
  readonly decision: FitnessDecision;
  readonly proposalEmitted: boolean;
  readonly lockApplied: boolean;
  readonly errorMessage: string | null;
}

/** Aggregate summary over a single nightly aggregation pass. */
export interface NightlySweepSummary {
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly recipesProcessed: number;
  readonly proposalsEmitted: number;
  readonly locksApplied: number;
  readonly errored: number;
  readonly results: ReadonlyArray<RecipeSweepResult>;
}
