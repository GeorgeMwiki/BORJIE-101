/**
 * Composer: Investor One-Pager — class `investor_one_pager`.
 *
 * Delegates final PDF composition to the Wave 17D document-templates
 * layer (recipe `investor_briefing`). This composer carries the
 * narrative outline + the artifact ref of the PDF the document layer
 * produced.
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

export interface InvestorOnePagerInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly headline: string;
  readonly tagline: string;
  readonly bullets: ReadonlyArray<string>;
  readonly pdf_artifact_ref: string;
  readonly disclaimers: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeInvestorOnePager(
  input: InvestorOnePagerInput,
): ComposedAsset {
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `investor_one_pager must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 3);

  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `# ${input.headline}`,
    `> ${input.tagline}`,
    '',
    ...input.bullets.map((b) => `- ${b}`),
    '',
    '## Disclaimers',
    ...input.disclaimers.map((d) => `> ${d}`),
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'investor_one_pager',
    channel: 'email',
    variant_id: input.variant_id,
    body,
    attachments: [
      Object.freeze({
        part: 'one_pager_pdf',
        mime_type: 'application/pdf',
        checksum: input.pdf_artifact_ref,
        artifact_ref: input.pdf_artifact_ref,
      }),
    ],
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
