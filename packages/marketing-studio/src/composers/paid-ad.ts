/**
 * Composer: Paid Ad Creative — class `paid_ad_creative`.
 *
 * Produces N variants for A/B testing. Each variant is a separate
 * ComposedAsset. Tier 2 — owner-approval required pre-publish on any
 * paid channel.
 */

import type {
  AudienceSegment,
  AuthorityTier,
  Channel,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { MarketingError } from '../types.js';
import { buildSegmentPromptPrefix } from '../audience/segment-prompts.js';
import {
  generateVariants,
  type Variant,
  type VariantBrief,
} from '../ab-testing/variant-generator.js';
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';

const SUPPORTED: ReadonlyArray<Channel> = Object.freeze([
  'google_ads',
  'meta_ads',
  'tiktok_ads',
  'linkedin_ads',
  'x_ads',
  'youtube_ads',
]);

export interface PaidAdInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_count: number;
  readonly brief: VariantBrief;
  readonly image_artifact_ref?: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composePaidAd(input: PaidAdInput): ReadonlyArray<ComposedAsset> {
  if (!SUPPORTED.includes(input.channel)) {
    throw new MarketingError(
      'UNSUPPORTED_CHANNEL',
      `paid_ad_creative does not support channel ${input.channel}`,
      [input.channel],
    );
  }
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `paid_ad_creative must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 1);

  const variants = generateVariants({
    recipe_id: input.recipe_id,
    channel: input.channel,
    audience_segment: input.audience_segment,
    variant_count: input.variant_count,
    brief: input.brief,
  });
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const generated_at = pinGeneratedAt(input.generated_at);

  return variants.map((v) =>
    buildComposedAsset({
      tenant_id: input.tenant_id,
      recipe_id: input.recipe_id,
      recipe_version: input.recipe_version,
      audience_segment: input.audience_segment,
      authority_tier: input.authority_tier,
      publish_authority_tier: input.publish_authority_tier,
      cls: 'paid_ad_creative',
      channel: input.channel,
      variant_id: v.id,
      body: renderAd(v, prefix),
      attachments:
        input.image_artifact_ref !== undefined
          ? [
              Object.freeze({
                part: 'creative_image',
                mime_type: 'image/png',
                checksum: input.image_artifact_ref,
                artifact_ref: input.image_artifact_ref,
              }),
            ]
          : [],
      span_citations: input.citations,
      generated_at,
    }),
  );
}

function renderAd(v: Variant, prefix: string): string {
  return [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `Headline: ${v.headline}`,
    `Body: ${v.base_message}`,
    `Tone: ${v.tone}`,
    `CTA: ${v.cta}`,
  ].join('\n');
}
