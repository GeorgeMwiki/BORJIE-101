/**
 * Marketing Studio — public contracts.
 *
 * Mirrors `docs/DESIGN/MARKETING_PROMOTION_SPEC.md`. The 12 closed-set
 * marketing classes are encoded as a discriminated string union; new
 * classes require an enum extension AND a passing recipe smoke test.
 *
 * Sibling contracts in the composition family:
 *   - `@borjie/document-templates`     (Wave 17D — durable docs)
 *   - `@borjie/media-generation`*      (Wave 18N — image/video)
 *   - `@borjie/research-tools`         (Wave 18R — evidence)
 *
 * *Wave 18N package not yet present in the workspace at the time of
 * this wave's first commit; the marketing recipe contract references
 * it abstractly via `recipe_ref.kind = 'media'`.
 *
 * All types are immutable (`readonly` everywhere) per coding-style.md.
 */

// ---------------------------------------------------------------------------
// Closed-set marketing classes — the 12 BORJIE recipes.
// ---------------------------------------------------------------------------

export type MarketingClass =
  | 'social_post_single'
  | 'social_thread'
  | 'short_video_spot'
  | 'long_video_story'
  | 'paid_ad_creative'
  | 'email_campaign'
  | 'landing_page'
  | 'seo_article'
  | 'press_release'
  | 'investor_one_pager'
  | 'buyer_brochure'
  | 'booth_event_kit';

export const ALL_MARKETING_CLASSES: ReadonlyArray<MarketingClass> = Object.freeze([
  'social_post_single',
  'social_thread',
  'short_video_spot',
  'long_video_story',
  'paid_ad_creative',
  'email_campaign',
  'landing_page',
  'seo_article',
  'press_release',
  'investor_one_pager',
  'buyer_brochure',
  'booth_event_kit',
]);

// ---------------------------------------------------------------------------
// Channels — 17 supported publish destinations.
// ---------------------------------------------------------------------------

export type Channel =
  | 'linkedin_organic'
  | 'linkedin_ads'
  | 'x_organic'
  | 'x_ads'
  | 'meta_organic'
  | 'meta_ads'
  | 'tiktok_organic'
  | 'tiktok_ads'
  | 'youtube_organic'
  | 'youtube_ads'
  | 'google_ads'
  | 'email'
  | 'web_landing'
  | 'pr_wire'
  | 'rss'
  | 'podcast';

export const ALL_CHANNELS: ReadonlyArray<Channel> = Object.freeze([
  'linkedin_organic',
  'linkedin_ads',
  'x_organic',
  'x_ads',
  'meta_organic',
  'meta_ads',
  'tiktok_organic',
  'tiktok_ads',
  'youtube_organic',
  'youtube_ads',
  'google_ads',
  'email',
  'web_landing',
  'pr_wire',
  'rss',
  'podcast',
]);

// ---------------------------------------------------------------------------
// Audience segments — per spec §6.
// ---------------------------------------------------------------------------

export type AudienceSegment =
  | 'mining_owner'
  | 'mineral_buyer'
  | 'institutional_investor'
  | 'regulator'
  | 'industry_partner'
  | 'mining_journalist'
  | 'general_public';

export const ALL_AUDIENCE_SEGMENTS: ReadonlyArray<AudienceSegment> = Object.freeze([
  'mining_owner',
  'mineral_buyer',
  'institutional_investor',
  'regulator',
  'industry_partner',
  'mining_journalist',
  'general_public',
]);

// ---------------------------------------------------------------------------
// Authority tiers — per the Master Brain manifesto.
//   0 = Read/Research only (internal drafts, never public)
//   1 = Draft/Stage (auto-publishes after 24 h owner approval window)
//   2 = Execute (requires explicit owner approval before publish)
// ---------------------------------------------------------------------------

export type AuthorityTier = 0 | 1 | 2;

export type RecipeStatus = 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';

export type PublishState = 'pending' | 'published' | 'failed' | 'withdrawn';

export type SequencingRule = 'parallel' | 'cascading' | 'staggered';

export type RunStatus =
  | 'draft'
  | 'pending_approval'
  | 'publishing'
  | 'live'
  | 'paused'
  | 'completed'
  | 'aborted';

export type TriggerSource = 'owner_explicit' | 'mr_mwikila_proactive';

// ---------------------------------------------------------------------------
// Sub-recipe reference. Marketing recipes delegate to document, media,
// or other marketing recipes — every asset has one.
// ---------------------------------------------------------------------------

export interface RecipeRef {
  readonly kind: 'document' | 'media' | 'marketing';
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Span citation — same shape as document-templates SpanCitation. Inlined
// rather than imported so this package can be consumed without pulling
// in the heavyweight document-templates barrel.
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
}

// ---------------------------------------------------------------------------
// A/B testing contract — per spec §7.
// ---------------------------------------------------------------------------

export interface ABTestSpec {
  readonly variant_count: number;
  /** Must sum to 1.0 ± 0.0001 and match variant_count length. */
  readonly traffic_split: ReadonlyArray<number>;
  readonly min_sample_size: number;
  readonly significance_alpha: number;
  readonly auto_promote_winner: boolean;
}

// ---------------------------------------------------------------------------
// Compliance contract — per spec §8 + §11.
// ---------------------------------------------------------------------------

export interface ComplianceContract {
  readonly claims_must_cite: boolean;
  readonly forbidden_phrases: ReadonlyArray<string>;
  readonly required_disclaimers: ReadonlyArray<string>;
  /** ISO 3166-1 alpha-2 country codes where this campaign is restricted. */
  readonly geo_restrictions: ReadonlyArray<string>;
}

export const DEFAULT_FORBIDDEN_PHRASES: ReadonlyArray<string> = Object.freeze([
  'guaranteed returns',
  'risk-free',
  'no risk',
  'fda-approved',
  'investment-grade certified',
  'cannot lose',
  'sure thing',
]);

export const DEFAULT_REQUIRED_DISCLAIMERS: ReadonlyArray<string> = Object.freeze([
  'Past performance does not predict future results.',
  'This is not investment advice.',
]);

// ---------------------------------------------------------------------------
// Success metric thresholds — per spec §7. Composer + lock-improve
// worker both read these.
// ---------------------------------------------------------------------------

export interface MetricThreshold {
  readonly kind:
    | 'ctr'
    | 'conversion_rate'
    | 'engagement_rate'
    | 'share_rate'
    | 'reply_rate'
    | 'unsubscribe_rate'
    | 'bounce_rate';
  /** Decimal threshold, e.g. 0.05 for 5%. */
  readonly threshold: number;
  /** Window in days over which the metric is computed. */
  readonly window_days: number;
}

// ---------------------------------------------------------------------------
// CampaignAsset — one per channel per variant per recipe slot.
// ---------------------------------------------------------------------------

export interface CampaignAsset {
  readonly id: string;
  readonly class: MarketingClass;
  readonly channel: Channel;
  readonly recipe_ref: RecipeRef;
  readonly variant_count: number;
  readonly publish_authority_tier: AuthorityTier;
}

// ---------------------------------------------------------------------------
// Owner profile + compose context — handed to recipes.
// ---------------------------------------------------------------------------

export interface OwnerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly preferred_language: 'en' | 'sw';
}

export interface CampaignComposeContext {
  readonly tenant_id: string;
  readonly intent_payload: unknown;
  readonly owner_profile: OwnerProfile;
  readonly audience_segment: AudienceSegment;
  readonly language: 'en' | 'sw';
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
  /** Optional storage bucket override; default per asset class. */
  readonly storage_bucket?: string;
}

// ---------------------------------------------------------------------------
// Composed asset artifact — the immutable per-asset product handed to
// the channel adapter for publish.
// ---------------------------------------------------------------------------

export interface ComposedAsset {
  readonly id: string;
  readonly class: MarketingClass;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly body: string;
  /** Optional binary attachments (image, PDF, etc.) keyed by part name. */
  readonly attachments: ReadonlyArray<ComposedAssetAttachment>;
  /** Citations embedded inline as [cite:ID] tokens. */
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly utm_tags: Readonly<Record<string, string>>;
  readonly publish_authority_tier: AuthorityTier;
  readonly audit_hash: string;
  readonly generated_at: string;
}

export interface ComposedAssetAttachment {
  readonly part: string;
  readonly mime_type: string;
  /** SHA-256 of the body. */
  readonly checksum: string;
  /** Reference to media-generation artifact id (preferred) or inline data. */
  readonly artifact_ref?: string;
  readonly inline_data?: string;
}

// ---------------------------------------------------------------------------
// CampaignArtifact — the result of `compose(ctx)` on a CampaignRecipe.
// ---------------------------------------------------------------------------

export interface CampaignArtifact {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly assets: ReadonlyArray<ComposedAsset>;
  readonly audit_hash: string;
  readonly generated_at: string;
}

// ---------------------------------------------------------------------------
// CampaignRecipe — the top-level versioned config.
// ---------------------------------------------------------------------------

export interface CampaignRecipe {
  readonly id: string;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly assets: ReadonlyArray<CampaignAsset>;
  readonly sequencing: SequencingRule;
  readonly audience_segments: ReadonlyArray<AudienceSegment>;
  readonly ab_testing: ABTestSpec | null;
  readonly success_metrics: ReadonlyArray<MetricThreshold>;
  readonly compliance: ComplianceContract;
  readonly authority_tier: AuthorityTier;
  readonly brand: 'borjie';
  readonly compose: (ctx: CampaignComposeContext) => Promise<CampaignArtifact>;
}

// ---------------------------------------------------------------------------
// Compose-level errors. Caller pattern-matches on `.code`.
// ---------------------------------------------------------------------------

export type MarketingErrorCode =
  | 'INPUT_GAP'
  | 'CITATION_GAP'
  | 'COMPLIANCE_REFUSED'
  | 'BRAND_VIOLATION'
  | 'GEO_RESTRICTED'
  | 'UNSUPPORTED_CHANNEL'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'STATE_TRANSITION_REFUSED'
  | 'INVARIANT_VIOLATION';

export class MarketingError extends Error {
  public readonly code: MarketingErrorCode;
  public readonly detail: ReadonlyArray<string>;

  public constructor(
    code: MarketingErrorCode,
    message: string,
    detail: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'MarketingError';
    this.code = code;
    this.detail = Object.freeze([...detail]);
  }
}
