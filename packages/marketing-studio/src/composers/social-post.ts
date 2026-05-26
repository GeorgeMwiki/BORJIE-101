/**
 * Composer: Social Post Single — class `social_post_single`.
 *
 * Produces a single text post + one image attachment. The text is
 * a deterministic template assembly from the brief; production code
 * will swap in an LLM call gated by the brain-llm-router. We keep
 * the helper pure so unit tests can run without any provider.
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

export interface SocialPostSingleInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly headline: string;
  readonly body: string;
  readonly cta: string;
  readonly image_artifact_ref?: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

const SUPPORTED_CHANNELS: ReadonlyArray<Channel> = Object.freeze([
  'linkedin_organic',
  'x_organic',
  'meta_organic',
  'tiktok_organic',
]);

export function composeSocialPostSingle(input: SocialPostSingleInput): ComposedAsset {
  if (!SUPPORTED_CHANNELS.includes(input.channel)) {
    throw new MarketingError(
      'UNSUPPORTED_CHANNEL',
      `social_post_single does not support channel ${input.channel}`,
      [input.channel],
    );
  }
  requireCitations(input.citations, 1);
  const generated_at = pinGeneratedAt(input.generated_at);
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const body = renderSocialPost({
    prefix_hint: prefix,
    headline: input.headline,
    body: input.body,
    cta: input.cta,
  });
  const attachments = input.image_artifact_ref !== undefined
    ? [
        Object.freeze({
          part: 'hero_image',
          mime_type: 'image/png',
          checksum: input.image_artifact_ref,
          artifact_ref: input.image_artifact_ref,
        }),
      ]
    : [];

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'social_post_single',
    channel: input.channel,
    variant_id: input.variant_id,
    body,
    attachments,
    span_citations: input.citations,
    generated_at,
  });
}

interface RenderArgs {
  readonly prefix_hint: string;
  readonly headline: string;
  readonly body: string;
  readonly cta: string;
}

function renderSocialPost(args: RenderArgs): string {
  // Production LLM call path elided — pure template assembly here so
  // tests do not depend on a provider. `prefix_hint` is included as a
  // hidden HTML comment so the brand-locked LLM swap-in can read it.
  return [
    `<!--prompt:${args.prefix_hint.slice(0, 200).replace(/-->/g, '')}-->`,
    args.headline,
    '',
    args.body,
    '',
    args.cta,
  ].join('\n');
}
