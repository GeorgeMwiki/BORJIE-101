/**
 * Composer: Booth / Event Kit — class `booth_event_kit`.
 *
 * Conference booth design + presentation deck. Delegates booth visuals
 * to media-generation (Wave 18N) and deck composition to
 * document-templates (Wave 17D). This composer carries the orchestration
 * + the artifact refs.
 */

import type {
  AudienceSegment,
  AuthorityTier,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { MarketingError } from '../types.js';
import { buildSegmentPromptPrefix } from '../audience/segment-prompts.js';
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';

export interface BoothKitInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly event_name: string;
  readonly event_dates: string;
  readonly booth_design_image_ref: string;
  readonly deck_pptx_ref: string;
  readonly takeaway_messages: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeBoothKit(input: BoothKitInput): ComposedAsset {
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `booth_event_kit must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 1);
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);

  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `# Booth kit — ${input.event_name}`,
    '',
    `Dates: ${input.event_dates}`,
    '',
    '## Takeaway messages',
    ...input.takeaway_messages.map((m) => `- ${m}`),
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'booth_event_kit',
    channel: 'email',
    variant_id: input.variant_id,
    body,
    attachments: [
      Object.freeze({
        part: 'booth_design_png',
        mime_type: 'image/png',
        checksum: input.booth_design_image_ref,
        artifact_ref: input.booth_design_image_ref,
      }),
      Object.freeze({
        part: 'deck_pptx',
        mime_type:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        checksum: input.deck_pptx_ref,
        artifact_ref: input.deck_pptx_ref,
      }),
    ],
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
