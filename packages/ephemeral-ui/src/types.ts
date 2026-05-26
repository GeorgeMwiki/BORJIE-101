/**
 * `@borjie/ephemeral-ui` — public types.
 *
 * Source of truth: `Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md`.
 *
 * The contract by which every domain function declares its UI manifest
 * and the composer emits a TabRecipe on demand. Strict types, all
 * immutable (`ReadonlyArray<T>`, `readonly` everywhere), `brand` of any
 * emitted recipe forced to `'borjie'`.
 *
 * No I/O. No DB. No React. Pure typed primitives + pure composer
 * functions. Server-safe (Node + Edge) and browser-safe.
 */
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Authority + mastery (kept in lock-step with @borjie/dynamic-ui)
// ---------------------------------------------------------------------------

/**
 * Authority tier of any submit action this manifest may expose.
 *
 *  - 0 → Mr. Mwikila may auto-apply inline.
 *  - 1 → Routes through ApprovalGate (Wave 18S).
 *  - 2 → ApprovalGate + second authoriser.
 */
export type AuthorityTier = 0 | 1 | 2;

/** Mastery level — duplicated on purpose so this package has no runtime
 * dependency on `@borjie/chat-ui`. Keep in sync with
 * `packages/chat-ui/src/lib/user-mastery/types.ts`. */
export type MasteryLevel =
  | 'novice'
  | 'intermediate'
  | 'expert'
  | 'power-user';

/** Locale Mr. Mwikila composes for. Bilingual-mandatory. */
export type Locale = 'en' | 'sw';

// ---------------------------------------------------------------------------
// Dashboard archetypes — the eleven closed choices the composer ranges over
// ---------------------------------------------------------------------------

/**
 * The eleven dashboard archetypes. A manifest must declare exactly one.
 *
 * `composite` is the only archetype that may combine others; it is the
 * escape hatch for genuinely multi-shape outputs.
 */
export type DashboardArchetype =
  | 'list_with_filters'
  | 'chart_with_table'
  | 'map_with_overlays'
  | 'kpi_grid'
  | 'pipeline_kanban'
  | 'calendar_timeline'
  | 'document_render'
  | 'split_compare'
  | 'wizard_form'
  | 'detail_with_chain'
  | 'composite';

/** Closed set used by `manifest-validator.ts` for schema enforcement. */
export const DASHBOARD_ARCHETYPES: ReadonlyArray<DashboardArchetype> = [
  'list_with_filters',
  'chart_with_table',
  'map_with_overlays',
  'kpi_grid',
  'pipeline_kanban',
  'calendar_timeline',
  'document_render',
  'split_compare',
  'wizard_form',
  'detail_with_chain',
  'composite',
] as const;

// ---------------------------------------------------------------------------
// UI hints — suggested visual treatment
// ---------------------------------------------------------------------------

export type PreferredSize = 'inline' | 'tab' | 'fullscreen' | 'modal';
export type PreferredLayout = 'cards' | 'table' | 'split' | 'tabs';
export type Emphasis = 'data_density' | 'narrative' | 'actionable';
export type MobileStrategy = 'reflow' | 'stack' | 'simplify' | 'hide_secondary';

/** Suggested visual treatment. Composer respects or overrides per context. */
export interface UIHints {
  readonly preferred_size: PreferredSize;
  /** OKLCH token refs from `@borjie/brand`. Raw hex/rgb is rejected. */
  readonly preferred_colors: ReadonlyArray<string>;
  readonly preferred_layout: PreferredLayout;
  readonly emphasis: Emphasis;
  readonly mobile_strategy: MobileStrategy;
}

// ---------------------------------------------------------------------------
// Context requirements
// ---------------------------------------------------------------------------

export type ContextRequirementKind =
  | 'scope'
  | 'recent_turns'
  | 'memory_recall'
  | 'brand_dna'
  | 'mastery_tier'
  | 'locale';

export interface ContextRequirement {
  readonly kind: ContextRequirementKind;
  readonly required: boolean;
}

// ---------------------------------------------------------------------------
// Action descriptors
// ---------------------------------------------------------------------------

/** A submit affordance the composer is allowed to wire into the recipe. */
export interface ActionDescriptor {
  readonly action_id: string;
  readonly authority_tier: AuthorityTier;
  readonly label: { readonly en: string; readonly sw: string };
}

// ---------------------------------------------------------------------------
// FunctionUIManifest — the contract
// ---------------------------------------------------------------------------

/**
 * The contract every domain function declares to host an ephemeral
 * dashboard.
 *
 * `function_id` mirrors Wave 18B's `intent.kind` for predictability.
 * `version` is bumped whenever `output_shape` or `allowed_actions`
 * change.
 *
 * `output_shape` is a Zod schema validated by the composer before any
 * rendering happens; output that fails validation is rejected (the
 * operator falls back to a chat-only answer).
 */
export interface FunctionUIManifest {
  readonly function_id: string;
  readonly version: number;
  readonly dashboard_archetype: DashboardArchetype;
  readonly required_context: ReadonlyArray<ContextRequirement>;
  readonly output_shape: z.ZodTypeAny;
  readonly ui_hints: UIHints;
  readonly authority_tier: AuthorityTier;
  readonly ephemeral_by_default: boolean;
  readonly cache_ttl_seconds: number;
  readonly allowed_actions?: ReadonlyArray<ActionDescriptor>;
}

// ---------------------------------------------------------------------------
// User context — fed to the composer
// ---------------------------------------------------------------------------

/** The six dimensions the composer reads. */
export interface UserContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly scope: {
    readonly kind: string;
    readonly id: string;
  };
  readonly recent_turns: ReadonlyArray<string>;
  readonly memory_recall: ReadonlyArray<MemoryRecallHit>;
  readonly brand_dna: BrandDnaSnapshot;
  readonly mastery_tier: MasteryLevel;
  readonly locale: Locale;
}

/** Single hit from cognitive-memory recall (Wave 18AA). */
export interface MemoryRecallHit {
  readonly cell_id: string;
  readonly archetype_hint?: DashboardArchetype;
  readonly engagement_score: number;
  readonly recipe_hash?: string;
}

/** Snapshot of the tenant's brand DNA at compose time. */
export interface BrandDnaSnapshot {
  readonly tokens_version: string;
  readonly oklch_color_tokens: ReadonlyArray<string>;
  readonly motion_preset: string;
}

// ---------------------------------------------------------------------------
// Lifecycle artefacts
// ---------------------------------------------------------------------------

/**
 * Minimal in-process structure representing the composed dashboard.
 *
 * The full TabRecipe is emitted by `composeDashboardForFunction` and
 * matches the shape `@borjie/dynamic-ui` exports. This package keeps a
 * tiny internal record for telemetry + caching keyed on its hash.
 */
export interface EphemeralDashboard {
  readonly recipe_hash: string;
  readonly archetype: DashboardArchetype;
  readonly composed_at: number;
  readonly cache_ttl_seconds: number;
  readonly was_cache_hit: boolean;
  readonly brand_lock_retries: number;
  readonly compose_fallback: boolean;
}

/**
 * The composer's failure modes. Caller can pattern-match for graceful
 * degradation.
 */
export type ComposeFailure =
  | { readonly kind: 'manifest_schema_mismatch'; readonly issues: ReadonlyArray<string> }
  | { readonly kind: 'brand_lock_exhausted'; readonly offenders: ReadonlyArray<string> }
  | { readonly kind: 'unwired_action'; readonly action_id: string };

/** Outcome shape for the composer's pure result. */
export type ComposeResult =
  | { readonly ok: true; readonly recipe_hash: string; readonly dashboard: EphemeralDashboard }
  | { readonly ok: false; readonly failure: ComposeFailure };

// ---------------------------------------------------------------------------
// Telemetry row — mirrors ephemeral_dashboard_telemetry
// ---------------------------------------------------------------------------

export interface EphemeralDashboardTelemetryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly function_id: string;
  readonly manifest_version: number;
  readonly generated_recipe_hash: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly scope_kind: string;
  readonly scope_id: string;
  readonly user_context_hash: string;
  readonly generated_at: string; // ISO-8601
  readonly closed_at: string | null;
  readonly reuse_count_for_this_pattern: number;
  readonly distinct_user_count_for_pattern: number;
  readonly was_promoted: boolean;
  readonly promotion_recipe_id: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Brand-lock pass outcome
// ---------------------------------------------------------------------------

export type BrandLockResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly offenders: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// Cache primitives
// ---------------------------------------------------------------------------

/** Key used by the in-memory cache. */
export interface ComposeCacheKey {
  readonly function_id: string;
  readonly manifest_version: number;
  readonly function_input_hash: string;
  readonly user_context_hash: string;
  readonly brand_tokens_version: string;
}

/** Entry stored under each cache key. */
export interface ComposeCacheEntry {
  readonly recipe_hash: string;
  readonly archetype: DashboardArchetype;
  readonly cached_at: number;
  readonly expires_at: number;
}
