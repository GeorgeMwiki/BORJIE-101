/**
 * `@borjie/media-generation` — public surface.
 *
 * Layers 1-4 of the Media Generation architecture per
 * `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`. Provides:
 *
 *   - MediaRecipe contract + registry (Layer 1).
 *   - Brand-DNA prompt prefix builder + output validator (Layer 2-3).
 *   - 11 provider adapters (Layer 3): Runway, Sora, Seedance, Flux,
 *     Ideogram, Recraft, Imagen, Hedra, HeyGen, Firefly, SD3.5.
 *   - Dispatcher with priority-ordered fallback.
 *   - 5-stage safety pipeline (Layer 4): NSFW, deepfake, brand
 *     violation, C2PA watermarking, visible watermark plan.
 *   - Cost-tracker, audit-chain link.
 *   - 3 seed recipes (`briefing_thumbnail`, `marketplace_listing_hero`,
 *     `social_post_still`); dynamic-author wave will generate the rest.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AdapterResult,
  ApprovalState,
  AuthorityTier,
  BrandPaletteAnchor,
  BrandSpec,
  ConsentToken,
  CostTracker,
  DataJoin,
  MasteryTier,
  MediaArtifact,
  MediaAspectRatio,
  MediaCapability,
  MediaClass,
  MediaComposeContext,
  MediaFormat,
  MediaLogger,
  MediaProviderAdapter,
  MediaProviderId,
  MediaProviderInput,
  MediaProvenance,
  MediaRecipe,
  MediaRecipeStatus,
  OwnerProfile,
  ProviderContext,
  PromptInputContract,
  SafetyScanResult,
  SpanCitation,
  TargetAudience,
} from './types.js';
export { MediaCompositionError, NOOP_LOGGER } from './types.js';

// ---------------------------------------------------------------------------
// Registry + composer
// ---------------------------------------------------------------------------

export {
  BUILT_IN_RECIPES,
  MediaRecipeRegistry,
  defaultMediaRecipeRegistry,
} from './registry.js';

export { composeMedia, type ComposeMediaArgs } from './composer.js';

// ---------------------------------------------------------------------------
// Brand-lock
// ---------------------------------------------------------------------------

export {
  BorjieBrandSpec,
  createBrandSpecRegistry,
  getBrandSpec,
  registerBrandSpec,
  setActiveBrandSpecRegistry,
  snapshotBrandSpecRegistry,
  type BrandSpecRegistry,
} from './brand-lock/brand-spec.js';
export {
  buildBrandPrefix,
  buildBrandedPrompt,
  buildNegativePrompt,
  hasBrandPrefix,
} from './brand-lock/prompt-prefix-builder.js';
export {
  DEFAULT_THRESHOLDS,
  validateOutputBrand,
  type OutputValidationInput,
  type OutputValidationResult,
  type VisionApiFn,
} from './brand-lock/output-validator.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export {
  MEDIA_CLASS_BUDGET_CENTS,
  MEDIA_CLASS_LATENCY_MS,
  budgetForClass,
  createClassBudgetTracker,
  createCostTracker,
  latencyMsForClass,
  type CostTrackerOptions,
} from './budgets/cost-tracker.js';

// ---------------------------------------------------------------------------
// Audit-chain link
// ---------------------------------------------------------------------------

export {
  buildMediaAuditLink,
  sha256Hex,
  type MediaAuditLink,
  type MediaAuditLinkArgs,
} from './audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export {
  applyBrandLock,
  assembleArtifact,
  initialApprovalForTier,
  negativePromptFor,
  noKey,
  permissiveSafetyScan,
  pickLogger,
  readEnvKey,
  reserveBudget,
  safeFetch,
  type AdapterMeta,
  type AssembleArtifactArgs,
  type BudgetGateArgs,
  type SafeFetchFailure,
  type SafeFetchOptions,
  type SafeFetchResult,
  type SafeFetchSuccess,
} from './providers/shared.js';

export {
  createThinAdapter,
  type ProviderShape,
  type ThinAdapterConfig,
} from './providers/factory.js';

export {
  createRunwayAdapter,
  RUNWAY_NAME,
  RUNWAY_MODEL_ID,
  RUNWAY_MODEL_VERSION,
  RUNWAY_COST_PER_SEC_CENTS,
} from './providers/runway-adapter.js';

export {
  createSoraAdapter,
  SORA_NAME,
  SORA_MODEL_ID,
  SORA_MODEL_VERSION,
  SORA_COST_PER_SEC_CENTS,
} from './providers/sora-adapter.js';

export {
  createSeedanceAdapter,
  SEEDANCE_NAME,
  SEEDANCE_MODEL_ID,
  SEEDANCE_MODEL_VERSION,
  SEEDANCE_COST_PER_SEC_CENTS,
} from './providers/seedance-adapter.js';

export {
  createFluxAdapter,
  FLUX_NAME,
  FLUX_MODEL_ID,
  FLUX_MODEL_VERSION,
  FLUX_COST_PER_IMAGE_CENTS,
} from './providers/flux-adapter.js';

export {
  createIdeogramAdapter,
  IDEOGRAM_NAME,
  IDEOGRAM_MODEL_ID,
  IDEOGRAM_MODEL_VERSION,
  IDEOGRAM_COST_PER_IMAGE_CENTS,
} from './providers/ideogram-adapter.js';

export {
  createRecraftAdapter,
  RECRAFT_NAME,
  RECRAFT_MODEL_ID,
  RECRAFT_MODEL_VERSION,
  RECRAFT_COST_PER_IMAGE_CENTS,
} from './providers/recraft-adapter.js';

export {
  createImagenAdapter,
  IMAGEN_NAME,
  IMAGEN_MODEL_ID,
  IMAGEN_MODEL_VERSION,
  IMAGEN_COST_PER_IMAGE_CENTS,
} from './providers/imagen-adapter.js';

export {
  createHedraAdapter,
  HEDRA_NAME,
  HEDRA_MODEL_ID,
  HEDRA_MODEL_VERSION,
  HEDRA_COST_PER_SEC_CENTS,
} from './providers/hedra-adapter.js';

export {
  createHeyGenAdapter,
  HEYGEN_NAME,
  HEYGEN_MODEL_ID,
  HEYGEN_MODEL_VERSION,
  HEYGEN_COST_PER_SEC_CENTS,
} from './providers/heygen-adapter.js';

export {
  createFireflyAdapter,
  FIREFLY_NAME,
  FIREFLY_MODEL_ID,
  FIREFLY_MODEL_VERSION,
  FIREFLY_COST_PER_IMAGE_CENTS,
} from './providers/firefly-adapter.js';

export {
  createSd35Adapter,
  SD35_NAME,
  SD35_MODEL_ID,
  SD35_MODEL_VERSION,
  SD35_COST_PER_IMAGE_CENTS,
} from './providers/sd35-adapter.js';

export {
  dispatchToProvider,
  reorderForCapability,
  FALLBACK_BY_CAPABILITY,
  type DispatchArgs,
  type DispatchResult,
} from './providers/dispatcher.js';

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export {
  scanForNsfw,
  NSFW_TIER_THRESHOLDS,
  type NsfwScanInput,
  type NsfwScanResult,
} from './safety/nsfw-scanner.js';
export {
  detectDeepfake,
  DEEPFAKE_TIER_THRESHOLDS,
  type DeepfakeScanInput,
  type DeepfakeScanResult,
} from './safety/deepfake-detector.js';
export {
  scanBrandViolation,
  type BrandScanInput,
  type BrandScanResult,
} from './safety/brand-violation-scanner.js';
export {
  DEFAULT_TENANT_RATING_POLICY,
  RATING_NSFW_CEILING,
  applyContentRatingGate,
  createTenantRatingPolicyRegistry,
  getTenantRatingPolicy,
  mergeRatingPolicy,
  registerTenantRatingPolicy,
  setActiveTenantRatingPolicyRegistry,
  snapshotTenantRatingPolicyRegistry,
  type ContentRating,
  type RatingGateInput,
  type RatingGateResult,
  type TenantRatingPolicy,
  type TenantRatingPolicyRegistry,
} from './safety/content-rating-gate.js';

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

export {
  buildC2paManifest,
  embedC2paManifest,
  extractC2paManifest,
  type BuildManifestArgs,
  type C2paManifest,
  type EmbedArgs,
} from './watermark/c2pa-embedder.js';
export {
  planVisibleWatermark,
  watermarkedExtension,
  type PlanWatermarkArgs,
  type VisibleWatermarkPlan,
} from './watermark/visible-watermark.js';

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export {
  briefingThumbnailRecipe,
  buildBriefingThumbnailRecipe,
} from './recipes/briefing-thumbnail.js';
export {
  marketplaceListingHeroRecipe,
  buildMarketplaceListingHeroRecipe,
} from './recipes/marketplace-listing-hero.js';
export {
  socialPostStillRecipe,
  buildSocialPostStillRecipe,
} from './recipes/social-post-still.js';

export {
  runRecipe,
  readData,
  readVisibleWatermarkPlan,
  type RunRecipeArgs,
} from './recipes/_helpers.js';
