/**
 * `@borjie/marketing-studio` — public surface.
 *
 * Marketing & Promotion Layer 1-2-3-4 (Wave 18P). Implements
 * `docs/DESIGN/MARKETING_PROMOTION_SPEC.md`.
 *
 *  - Layer 1: campaign intent → recipe selection (CampaignRecipeRegistry)
 *  - Layer 2: per-asset composition (composers/* + composeCampaign)
 *  - Layer 3: brand + compliance validation (compliance/*)
 *  - Layer 4: channel publish + telemetry (channels/* + telemetry/*)
 */

// ── Types ────────────────────────────────────────────────────────────
export {
  ALL_AUDIENCE_SEGMENTS,
  ALL_CHANNELS,
  ALL_MARKETING_CLASSES,
  DEFAULT_FORBIDDEN_PHRASES,
  DEFAULT_REQUIRED_DISCLAIMERS,
  MarketingError,
} from './types.js';
export type {
  ABTestSpec,
  AudienceSegment,
  AuthorityTier,
  CampaignArtifact,
  CampaignAsset,
  CampaignComposeContext,
  CampaignRecipe,
  Channel,
  ComplianceContract,
  ComposedAsset,
  ComposedAssetAttachment,
  MarketingClass,
  MarketingErrorCode,
  MetricThreshold,
  OwnerProfile,
  PublishState,
  RecipeRef,
  RecipeStatus,
  RunStatus,
  SequencingRule,
  SpanCitation,
  TriggerSource,
} from './types.js';

// ── Registry + composer ───────────────────────────────────────────────
export { CampaignRecipeRegistry, BUILT_IN_RECIPES } from './registry.js';
export { composeCampaign, type ComposeOutcome } from './composer.js';

// ── Audience ──────────────────────────────────────────────────────────
export {
  SEGMENT_PROMPTS,
  buildSegmentPromptPrefix,
} from './audience/segment-prompts.js';
export {
  resolveAudienceSegment,
  type ResolverInput,
} from './audience/segment-resolver.js';

// ── Composers ─────────────────────────────────────────────────────────
export { composeSocialPostSingle } from './composers/social-post.js';
export { composeSocialThread } from './composers/social-thread.js';
export { composeShortVideo } from './composers/short-video.js';
export { composeLongVideo } from './composers/long-video.js';
export { composePaidAd } from './composers/paid-ad.js';
export { composeEmailCampaign } from './composers/email.js';
export { composeLandingPage } from './composers/landing-page.js';
export { composeSeoArticle } from './composers/seo-article.js';
export { composePressRelease } from './composers/press-release.js';
export { composeInvestorOnePager } from './composers/investor-one-pager.js';
export { composeBuyerBrochure } from './composers/buyer-brochure.js';
export { composeBoothKit } from './composers/booth-kit.js';

// ── Channels ──────────────────────────────────────────────────────────
export {
  dispatchChannel,
  listRegisteredChannels,
} from './channels/dispatcher.js';
export type {
  ChannelAdapter,
  PublishContext,
  PublishFailureCode,
  PublishResult,
} from './channels/_adapter.js';

// ── Compliance ────────────────────────────────────────────────────────
export {
  runComplianceScan,
  findUncitedClaims,
  claimsAllCited,
  scanForbiddenPhrases,
  findMissingDisclaimers,
  findGeoRestrictionFlags,
} from './compliance/index.js';
export type { ComplianceScanResult, UncitedClaim } from './compliance/index.js';

// ── SEO ───────────────────────────────────────────────────────────────
export {
  buildOrganizationLd,
  buildNewsArticleLd,
  buildBreadcrumbLd,
  serializeJsonLd,
} from './seo/json-ld-builder.js';
export type {
  OrganizationLd,
  NewsArticleLd,
  ProductLd,
  BreadcrumbListLd,
} from './seo/json-ld-builder.js';
export { buildOgMeta } from './seo/og-meta-builder.js';
export type { OgMetaArgs } from './seo/og-meta-builder.js';
export {
  buildSitemapEntry,
  renderSitemapXml,
} from './seo/sitemap-injector.js';
export type { SitemapEntry } from './seo/sitemap-injector.js';

// ── A/B testing ───────────────────────────────────────────────────────
export {
  generateVariants,
  type Variant,
  type VariantBrief,
} from './ab-testing/variant-generator.js';
export { assignVariant, type Assignment } from './ab-testing/traffic-splitter.js';
export {
  decideWinner,
  type DecisionInput,
  type DecisionResult,
  type VariantStat,
} from './ab-testing/bayes-decider.js';
export {
  decidePromotion,
  type PromotionDecision,
  type PromotionVerdict,
} from './ab-testing/auto-promotion.js';

// ── Telemetry ─────────────────────────────────────────────────────────
export {
  buildUtmTags,
  applyUtmToUrl,
  applyUtmToBody,
  type UtmTags,
} from './telemetry/utm-builder.js';
export {
  buildTelemetryEvent,
  type EventKind,
  type TelemetryEvent,
} from './telemetry/conversion-tracker.js';
export {
  attributeLastTouch,
  type AttributionArgs,
  type AttributionResult,
} from './telemetry/attribution.js';

// ── Budgets ───────────────────────────────────────────────────────────
export {
  COST_CEILINGS_USD,
  LATENCY_CEILINGS_SEC,
  CostTracker,
  type Reservation,
} from './budgets/cost-tracker.js';

// ── Audit chain ───────────────────────────────────────────────────────
export {
  buildMarketingAuditLink,
  buildLinkFromAsset,
  type MarketingAuditLinkArgs,
  type MarketingAuditLink,
} from './audit/audit-chain-link.js';

// ── Seed recipes ──────────────────────────────────────────────────────
export { investorAnnouncementRecipe } from './recipes/investor-announcement.js';
export { buyerAcquisitionRecipe } from './recipes/buyer-acquisition.js';
export { regulatoryTransparencyRecipe } from './recipes/regulatory-transparency.js';
