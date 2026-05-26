/**
 * Junior Dynamic Spawning — type surface (Wave 18V-DYNAMIC).
 *
 * Companion to `Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md`. The MD
 * ("Mr. Mwikila") dynamically authors new specialists when an intent
 * does not match a seed junior. Three provenance classes — `seed`,
 * `spawned`, `tenant_authored` — share one lifecycle state machine:
 * `draft → shadow → live → locked → deprecated`.
 *
 * NOTE: this file does not import from the sibling `junior-contract.ts`
 * — that file is being edited concurrently by Wave 18V-FIX. We
 * duplicate the small contract shapes we need here. When 18V-FIX
 * lands the additive exports can be replaced with a thin re-export.
 *
 * Spec cross-link: `JUNIOR_DYNAMIC_SPAWNING_SPEC.md`.
 */

// ─────────────────────────────────────────────────────────────────────
// Provenance + lifecycle
// ─────────────────────────────────────────────────────────────────────

/**
 * Where this junior came from.
 *
 * - `seed`            — pre-registered in code (the original 27).
 * - `spawned`         — LLM-authored at runtime.
 * - `tenant_authored` — created via the admin portal by an owner / admin.
 */
export type JuniorProvenance = 'seed' | 'spawned' | 'tenant_authored';

/**
 * Lifecycle state. Mirrors the recipe lock/improve vocabulary so
 * operators only have to learn the model once.
 */
export type JuniorLifecycleStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

// ─────────────────────────────────────────────────────────────────────
// Re-declared minimal slices of the JuniorPersona contract
// ─────────────────────────────────────────────────────────────────────
//
// These shapes are *structurally compatible* with the canonical
// definitions in `junior-contract.ts`. Re-declaring locally keeps this
// module decoupled from concurrent edits to that file (Wave 18V-FIX).

export type SpawnerAudience =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'employee'
  | 'customer'
  | 'regulator';

export interface SpawnerJuniorScope {
  readonly data_tables: ReadonlyArray<string>;
  readonly tab_recipes_owned: ReadonlyArray<string>;
  readonly doc_recipes_owned: ReadonlyArray<string>;
  readonly media_recipes_owned: ReadonlyArray<string>;
  readonly research_topics: ReadonlyArray<string>;
  readonly authority_tier_max: 0 | 1 | 2;
  readonly requires_md_for_tier_2: boolean;
}

export interface SpawnerJuniorMode {
  readonly id: string;
  readonly name: string;
  readonly mandate: string;
  readonly sample_prompts: ReadonlyArray<string>;
  readonly tools_allowed: ReadonlyArray<string>;
  readonly system_prompt: string;
}

export interface SpawnerEscalationPolicy {
  readonly auto_escalate_above_authority_tier: 1 | 2;
  readonly auto_escalate_on_cross_domain: boolean;
  readonly auto_escalate_on_low_confidence: boolean;
  readonly hand_off_transcript_to_mr_mwikila: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Selection — request + decision
// ─────────────────────────────────────────────────────────────────────

/**
 * Lightweight handle to a live research session — opaque to the
 * spawner; carried through for downstream observability only.
 */
export interface ResearchSessionHandle {
  readonly session_id: string;
  readonly tenant_id: string;
}

/**
 * A scope envelope that has already been resolved by the org-scope
 * (Wave 18Q) layer. The spawner does not re-resolve.
 */
export interface ResolvedScope {
  readonly scope_id: string;
  readonly audience: SpawnerAudience;
  readonly intent_keywords: ReadonlyArray<string>;
}

/**
 * Reference to an attachment the user uploaded with their turn. Pure
 * carrier — the spawner only counts them as evidence signals.
 */
export interface AttachmentRef {
  readonly attachment_id: string;
  readonly kind: string;
}

/**
 * The spawner's input envelope. `selectJunior` and `spawnNewJunior`
 * both take this shape so callers can pipe through one object.
 */
export interface JuniorSpawnRequest {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly intent_natural_language: string;
  readonly research_session_handle: ResearchSessionHandle | null;
  readonly active_scope: ResolvedScope;
  readonly evidence_attachments?: ReadonlyArray<AttachmentRef>;
}

/**
 * The four legal outcomes of `selectJunior`. `spawn_new` indicates
 * the caller should follow up with `spawnNewJunior` and route the
 * turn to the freshly-authored draft.
 */
export type SpawnDecisionKind =
  | 'use_seed'
  | 'use_spawned'
  | 'use_tenant_authored'
  | 'spawn_new';

/**
 * The decision returned by `selectJunior`. The `subtitle` is the
 * only string the chat surface renders (alongside the constant
 * "Mr. Mwikila" display name).
 */
export interface SpawnDecision {
  readonly kind: SpawnDecisionKind;
  readonly junior_id: string;
  readonly specialisation: string;
  readonly subtitle: string;
  readonly reasoning: string;
  readonly confidence: number;
}

// ─────────────────────────────────────────────────────────────────────
// Spawn — LLM-authored payload
// ─────────────────────────────────────────────────────────────────────

/**
 * The raw payload an LLM call returns before validation. The
 * `payload-validator` checks this against the canonical JuniorPersona
 * contract via Zod and refuses malformed proposals.
 */
export interface SpawnedJuniorAuthorPayload {
  readonly proposed_agent_id: string;
  readonly proposed_specialisation: string;
  readonly proposed_subtitle: string;
  readonly proposed_scope: SpawnerJuniorScope;
  readonly proposed_modes: ReadonlyArray<SpawnerJuniorMode>;
  readonly proposed_escalation_policy: SpawnerEscalationPolicy;
  readonly proposed_audiences: ReadonlyArray<SpawnerAudience>;
  readonly proposed_authority_tier_max: 0 | 1 | 2;
  readonly llm_reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────
// Persisted record — what the repository round-trips
// ─────────────────────────────────────────────────────────────────────

/**
 * The full persisted shape of a junior persona — including the
 * provenance + lifecycle columns added by migration 0027. Storage-
 * agnostic; the in-memory repository uses this shape too.
 */
export interface PersistedJuniorRecord {
  readonly id: string;
  readonly display_name: 'Mr. Mwikila';
  readonly subtitle: string;
  readonly specialisation: string;
  readonly provenance: JuniorProvenance;
  readonly lifecycle_status: JuniorLifecycleStatus;
  readonly scope: SpawnerJuniorScope;
  readonly modes: ReadonlyArray<SpawnerJuniorMode>;
  readonly escalation_policy: SpawnerEscalationPolicy;
  readonly target_audiences: ReadonlyArray<SpawnerAudience>;
  readonly authority_tier_max: 0 | 1 | 2;
  readonly tenant_id: string | null;
  readonly usage_count: number;
  readonly avg_satisfaction: number | null;
  readonly last_used_at: Date | null;
  readonly spawned_by_user_id: string | null;
  readonly spawned_from_turn_id: string | null;
  readonly promoted_at: Date | null;
  readonly locked_at: Date | null;
  readonly deprecated_at: Date | null;
}

// ─────────────────────────────────────────────────────────────────────
// Function signatures (named for dependency injection)
// ─────────────────────────────────────────────────────────────────────

export interface SelectJuniorFn {
  (request: JuniorSpawnRequest): Promise<SpawnDecision>;
}

export interface SpawnNewJuniorFn {
  (request: JuniorSpawnRequest): Promise<SpawnedJuniorAuthorPayload>;
}

// ─────────────────────────────────────────────────────────────────────
// Satisfaction feedback
// ─────────────────────────────────────────────────────────────────────

export type FeedbackKind =
  | 'explicit_positive'
  | 'explicit_negative'
  | 'implicit_completed'
  | 'implicit_abandoned';

/**
 * One row in `junior_turn_feedback`. `satisfaction_score` is the
 * normalised 0..1 derivation; the raw `feedback_kind` carries the
 * upstream signal that produced it.
 */
export interface JuniorTurnFeedbackRecord {
  readonly id: string;
  readonly junior_id: string;
  readonly tenant_id: string;
  readonly turn_id: string;
  readonly satisfaction_score: number | null;
  readonly feedback_kind: FeedbackKind;
  readonly recorded_at: Date;
}

// ─────────────────────────────────────────────────────────────────────
// Lifecycle promotion / deprecation thresholds
// ─────────────────────────────────────────────────────────────────────

/**
 * Spec §3 defaults. Stored alongside the junior so the owner can
 * tighten per-tenant — defaults are not constants in the worker.
 */
export interface LifecycleThresholds {
  readonly shadow_to_live_min_uses: number;        // default 10
  readonly shadow_to_live_min_satisfaction: number; // default 0.7
  readonly live_to_locked_min_uses: number;        // default 50
  readonly live_to_locked_min_satisfaction: number; // default 0.85
  readonly live_to_locked_sustain_days: number;    // default 30
  readonly deprecation_satisfaction_floor: number; // default 0.3
  readonly deprecation_idle_days: number;          // default 60
}

export const DEFAULT_LIFECYCLE_THRESHOLDS: LifecycleThresholds = Object.freeze({
  shadow_to_live_min_uses: 10,
  shadow_to_live_min_satisfaction: 0.7,
  live_to_locked_min_uses: 50,
  live_to_locked_min_satisfaction: 0.85,
  live_to_locked_sustain_days: 30,
  deprecation_satisfaction_floor: 0.3,
  deprecation_idle_days: 60,
});

// ─────────────────────────────────────────────────────────────────────
// Constants the spawner enforces
// ─────────────────────────────────────────────────────────────────────

/** Score cutoff for "good-enough" match in the selection algorithm. */
export const SELECTION_MATCH_THRESHOLD = 0.85;

/**
 * Display-name invariant. Every junior — seed, spawned, or tenant-
 * authored — renders as exactly this string in user-facing surfaces.
 */
export const MR_MWIKILA_DISPLAY_NAME = 'Mr. Mwikila' as const;
