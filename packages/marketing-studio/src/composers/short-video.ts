/**
 * Composer: Short Video Spot — class `short_video_spot`.
 *
 * Delegates the actual video synthesis to the (future) Wave 18N
 * media-generation package. This composer carries the prompt brief,
 * the video artifact ref (from media-generation), and the channel
 * caption.
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

const SUPPORTED: ReadonlyArray<Channel> = Object.freeze([
  'tiktok_organic',
  'tiktok_ads',
  'meta_organic',
  'youtube_organic',
  'x_organic',
]);

export interface ShortVideoInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly caption: string;
  readonly duration_sec: number;
  readonly video_artifact_ref: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeShortVideo(input: ShortVideoInput): ComposedAsset {
  if (!SUPPORTED.includes(input.channel)) {
    throw new MarketingError(
      'UNSUPPORTED_CHANNEL',
      `short_video_spot does not support channel ${input.channel}`,
      [input.channel],
    );
  }
  if (input.duration_sec <= 0 || input.duration_sec > 30) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `short_video_spot duration must be 1-30s; got ${input.duration_sec}`,
      [String(input.duration_sec)],
    );
  }
  requireCitations(input.citations, 1);
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    input.caption,
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'short_video_spot',
    channel: input.channel,
    variant_id: input.variant_id,
    body,
    attachments: [
      Object.freeze({
        part: 'video',
        mime_type: 'video/mp4',
        checksum: input.video_artifact_ref,
        artifact_ref: input.video_artifact_ref,
      }),
    ],
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
