/**
 * Composer: Social Thread — class `social_thread`.
 *
 * Renders an X/LinkedIn multi-post narrative. Each post is one segment
 * separated by `\n---\n`. Channel-length enforcement applies per
 * segment (X 280, LinkedIn 3000) — the composer pre-validates.
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
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';

const PER_POST_LIMITS: Readonly<Record<Channel, number>> = Object.freeze({
  linkedin_organic: 3000,
  linkedin_ads: 600,
  x_organic: 280,
  x_ads: 280,
  meta_organic: 2200,
  meta_ads: 1500,
  tiktok_organic: 2200,
  tiktok_ads: 1500,
  youtube_organic: 5000,
  youtube_ads: 1500,
  google_ads: 90,
  email: 1_000_000,
  web_landing: 1_000_000,
  pr_wire: 1_000_000,
  rss: 1_000_000,
  podcast: 1_000_000,
});

const SUPPORTED: ReadonlyArray<Channel> = Object.freeze(['x_organic', 'linkedin_organic']);

export interface SocialThreadInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly segments: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeSocialThread(input: SocialThreadInput): ComposedAsset {
  if (!SUPPORTED.includes(input.channel)) {
    throw new MarketingError(
      'UNSUPPORTED_CHANNEL',
      `social_thread does not support channel ${input.channel}`,
      [input.channel],
    );
  }
  if (input.segments.length < 2) {
    throw new MarketingError(
      'INPUT_GAP',
      'social_thread requires at least 2 segments',
      [String(input.segments.length)],
    );
  }
  requireCitations(input.citations, 1);

  const limit = PER_POST_LIMITS[input.channel];
  for (let i = 0; i < input.segments.length; i++) {
    const seg = input.segments[i] ?? '';
    if (seg.length > limit) {
      throw new MarketingError(
        'INVARIANT_VIOLATION',
        `segment ${i} length ${seg.length} exceeds per-post limit ${limit}`,
        [String(i), String(seg.length), String(limit)],
      );
    }
  }

  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    input.segments.join('\n---\n'),
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'social_thread',
    channel: input.channel,
    variant_id: input.variant_id,
    body,
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
