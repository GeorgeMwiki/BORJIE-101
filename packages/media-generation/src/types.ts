/**
 * Media Generation — public contracts.
 *
 * Mirrors `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`. The closed-set media
 * classes are encoded as a discriminated string union; new classes
 * require an enum extension AND a passing recipe-smoke test.
 *
 * All types are immutable (`readonly` everywhere) per coding-style.md.
 *
 * @module @borjie/media-generation/types
 */

// ---------------------------------------------------------------------------
// Closed-set media classes — the 9 Borjie media families.
// ---------------------------------------------------------------------------

export type MediaClass =
  | 'marketing_still'
  | 'marketplace_listing_hero'
  | 'site_visualisation'
  | 'briefing_thumbnail'
  | 'investor_brand_video'
  | 'social_post_still'
  | 'social_post_short_video'
  | 'tutorial_lipsync_video'
  | 'avatar_talking_head';

export type MediaFormat = 'image' | 'short_video' | 'lipsync_video';

export type MediaAspectRatio = '1:1' | '4:5' | '9:16' | '16:9' | '21:9';

export type MediaRecipeStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

/**
 * Authority tier per the Master Brain manifesto.
 *  - 0 = internal sketches / briefing thumbnails (auto-publish to owner)
 *  - 1 = staged for owner review (24 h auto-promote)
 *  - 2 = public-facing / paid-marketing / talking-head (owner approval required)
 */
export type AuthorityTier = 0 | 1 | 2;

export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'auto_published';

// ---------------------------------------------------------------------------
// Provider + capability enums
// ---------------------------------------------------------------------------

export type MediaProviderId =
  | 'runway'
  | 'sora'
  | 'seedance'
  | 'flux'
  | 'ideogram'
  | 'recraft'
  | 'imagen'
  | 'hedra'
  | 'heygen'
  | 'firefly'
  | 'sd35';

export type MediaCapability =
  | 'text_to_image'
  | 'image_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'lipsync_video'
  | 'inpainting';

// ---------------------------------------------------------------------------
// Span citation — shape matches `@borjie/document-templates`. Kept here
// so the package does not depend on document-templates.
// ---------------------------------------------------------------------------

export interface SpanCitation {
  readonly id: string;
  readonly claim: string;
  readonly source: {
    readonly kind:
      | 'corpus_chunk'
      | 'research_result'
      | 'ledger'
      | 'measurement'
      | 'statute'
      | 'assay_cert'
      | 'external';
    readonly ref: string;
    readonly url?: string;
  };
  readonly span?: {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly quotedSpan: string;
  };
}

// ---------------------------------------------------------------------------
// Input + citation contracts (recipe-declared requirements).
// ---------------------------------------------------------------------------

export interface PromptInputContract {
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
}

// ---------------------------------------------------------------------------
// BrandSpec — the source-of-truth for the brand-DNA prompt prefix system.
// ---------------------------------------------------------------------------

export interface BrandPaletteAnchor {
  readonly name: string;
  readonly oklch: string;
  readonly hex: string;
}

export interface BrandSpec {
  readonly brand: 'borjie';
  readonly photographic_style: string;
  readonly palette: ReadonlyArray<BrandPaletteAnchor>;
  readonly typography_rule: string;
  readonly wordmark_policy: string;
  readonly negative_prompt_terms: ReadonlyArray<string>;
  readonly wordmark_svg_path: string;
  readonly signature_gradient_direction: string;
  /** When true, recipes depicting a real person require a consent token. */
  readonly real_person_consent_required: boolean;
}

// ---------------------------------------------------------------------------
// Compose context — what the dispatcher hands the recipe.
// ---------------------------------------------------------------------------

export interface OwnerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly preferred_language: 'en' | 'sw';
}

export interface DataJoin {
  readonly key: string;
  readonly value: unknown;
}

export type MasteryTier = 'novice' | 'fluent' | 'veteran';

export type TargetAudience =
  | 'owner'
  | 'regulator'
  | 'investor'
  | 'buyer'
  | 'internal';

export interface ConsentToken {
  readonly subject_id: string;
  readonly granted_at: string;
  readonly scope: 'avatar_talking_head' | 'tutorial_lipsync_video' | 'all';
  readonly token: string;
}

export interface MediaComposeContext {
  readonly tenant_id: string;
  readonly intent_payload: unknown;
  readonly available_data: ReadonlyArray<DataJoin>;
  readonly research_result_id: string | null;
  readonly owner_profile: OwnerProfile;
  readonly mastery_tier: MasteryTier;
  readonly target_audience: TargetAudience;
  readonly language: 'en' | 'sw';
  /** Citations the upstream retriever has supplied. Every numeric /
   *  dated / regulatory claim in the rendered media must reference one
   *  of these. */
  readonly citations: ReadonlyArray<SpanCitation>;
  /** Consent token when subject is a real person. */
  readonly consent_token?: ConsentToken;
  /** Reproducibility seed — pin the renderer's "now" so checksums are
   *  stable across runs in tests. */
  readonly generated_at?: string;
  /** Storage bucket override — defaults to `borjie-media-${class}`. */
  readonly storage_bucket?: string;
  /** Brand spec override — defaults to the BorjieBrandSpec. */
  readonly brand_spec?: BrandSpec;
}

// ---------------------------------------------------------------------------
// Safety scan — the per-artifact aggregate
// ---------------------------------------------------------------------------

export interface SafetyScanResult {
  readonly nsfw_probability: number;
  readonly deepfake_probability: number;
  readonly brand_violation_flags: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Provenance — sealed into every artifact + audit chain row.
// ---------------------------------------------------------------------------

export interface MediaProvenance {
  readonly model_id: string;
  readonly model_version: string;
  readonly model_provider: MediaProviderId;
  readonly prompt_text: string;
  readonly prompt_image_refs: ReadonlyArray<string>;
  readonly seed: string;
  readonly safety_scan: SafetyScanResult;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
}

// ---------------------------------------------------------------------------
// Artifact — the persisted output.
// ---------------------------------------------------------------------------

export interface MediaArtifact {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly format: MediaFormat;
  readonly storage_key: string;
  readonly thumb_storage_key: string;
  readonly checksum: string;
  readonly provenance: MediaProvenance;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly audit_hash: string;
  readonly approval_state: ApprovalState;
  readonly approved_by?: string;
  readonly approved_at?: string;
  /** Raw artifact bytes. The caller persists these to Supabase Storage
   *  under `storage_key`. */
  readonly body: Buffer;
  /** ISO 8601 wall-clock when the artifact was sealed. */
  readonly generated_at: string;
}

// ---------------------------------------------------------------------------
// MediaRecipe — the registry entry.
// ---------------------------------------------------------------------------

export interface MediaRecipe {
  readonly id: string;
  readonly class: MediaClass;
  readonly version: number;
  readonly status: MediaRecipeStatus;
  readonly compose: (ctx: MediaComposeContext) => Promise<MediaArtifact>;
  readonly required_prompt_inputs: ReadonlyArray<PromptInputContract>;
  readonly output_format: MediaFormat;
  readonly target_aspect_ratio: MediaAspectRatio;
  readonly target_duration_sec?: number;
  readonly authority_tier: AuthorityTier;
  readonly brand: 'borjie';
  readonly approval_required: boolean;
}

// ---------------------------------------------------------------------------
// Provider context + adapter contract
// ---------------------------------------------------------------------------

/**
 * Cost-tracker surface — same shape as research-tools'. Adapters call
 * `tryReserve` BEFORE the network call; commit on success; release on
 * failure.
 */
export interface CostTracker {
  tryReserve(estimated_cents: number): Promise<boolean>;
  commit(measured_cents: number): Promise<void>;
  release(reserved_cents: number): Promise<void>;
  spent(): Promise<number>;
  budget(): number;
}

export interface MediaLogger {
  warn(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  info(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  error(msg: string, meta?: Readonly<Record<string, unknown>>): void;
}

export const NOOP_LOGGER: MediaLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
};

export interface ProviderContext {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly brand_spec: BrandSpec;
  readonly cost_tracker: CostTracker;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: MediaLogger;
  /** Seed for deterministic generation in tests. */
  readonly seed?: string;
}

export interface MediaProviderAdapter<TInput, TOutput extends MediaArtifact> {
  readonly name: string;
  readonly model_id: string;
  readonly model_version: string;
  readonly provider_id: MediaProviderId;
  readonly capabilities: ReadonlyArray<MediaCapability>;
  readonly cost_per_unit_usd_cents: number;
  readonly invoke: (input: TInput, ctx: ProviderContext) => Promise<TOutput | null>;
  readonly applyBrandLock: (prompt: string, brand: BrandSpec) => string;
}

/**
 * Adapter invocation input — common shape across providers. Provider
 * adapters narrow it further if they need extra fields.
 */
export interface MediaProviderInput {
  readonly prompt: string;
  readonly aspect_ratio: MediaAspectRatio;
  readonly duration_sec?: number;
  readonly reference_image_urls?: ReadonlyArray<string>;
  readonly reference_audio_url?: string;
  readonly format: MediaFormat;
}

/**
 * Adapter return — wrapped MediaArtifact (or `null` when the adapter
 * degraded gracefully because env keys were absent).
 */
export type AdapterResult = MediaArtifact | null;

// ---------------------------------------------------------------------------
// Failure modes — composition refuses rather than ships a bad artifact.
// ---------------------------------------------------------------------------

export class MediaCompositionError extends Error {
  public readonly code:
    | 'INPUT_GAP'
    | 'CITATION_GAP'
    | 'BRAND_VIOLATION'
    | 'CONSENT_MISSING'
    | 'RECIPE_NOT_FOUND'
    | 'PROVIDER_NOT_AVAILABLE'
    | 'BUDGET_EXCEEDED'
    | 'SAFETY_REFUSED'
    | 'STATE_TRANSITION_REFUSED'
    | 'UNSUPPORTED_FORMAT';

  public readonly detail: ReadonlyArray<string>;

  public constructor(
    code: MediaCompositionError['code'],
    message: string,
    detail: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'MediaCompositionError';
    this.code = code;
    this.detail = detail;
  }
}
