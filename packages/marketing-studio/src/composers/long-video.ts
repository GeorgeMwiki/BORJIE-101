/**
 * Composer: Long Video Story — class `long_video_story`.
 *
 * 1-10 min narrative video. Tier 2 — requires owner approval before
 * any public publish. Delegates synthesis to Wave 18N.
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
  'youtube_organic',
  'linkedin_organic',
]);

export interface LongVideoInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly title: string;
  readonly description: string;
  readonly duration_sec: number;
  readonly video_artifact_ref: string;
  readonly chapter_markers: ReadonlyArray<{
    readonly t_sec: number;
    readonly label: string;
  }>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeLongVideo(input: LongVideoInput): ComposedAsset {
  if (!SUPPORTED.includes(input.channel)) {
    throw new MarketingError(
      'UNSUPPORTED_CHANNEL',
      `long_video_story does not support channel ${input.channel}`,
      [input.channel],
    );
  }
  if (input.duration_sec < 60 || input.duration_sec > 600) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `long_video_story duration must be 60-600s; got ${input.duration_sec}`,
      [String(input.duration_sec)],
    );
  }
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `long_video_story must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 2);

  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const chapters = input.chapter_markers
    .map((c) => `${formatTime(c.t_sec)} ${c.label}`)
    .join('\n');
  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `# ${input.title}`,
    '',
    input.description,
    '',
    '## Chapters',
    chapters,
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'long_video_story',
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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
