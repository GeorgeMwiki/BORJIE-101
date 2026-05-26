/**
 * Composer: Buyer Brochure — class `buyer_brochure`.
 *
 * Mineral / parcel spec sheet for outbound buyer outreach. Delegates
 * PDF composition to the document-templates layer (`buyer_kyb_pack`
 * variant). Tier 1 — owner-facing draft with 24 h auto-promote.
 */

import type {
  AudienceSegment,
  AuthorityTier,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { buildSegmentPromptPrefix } from '../audience/segment-prompts.js';
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';

export interface BuyerBrochureInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly parcel_id: string;
  readonly ore_grade: string;
  readonly assay_summary: string;
  readonly provenance_chain: ReadonlyArray<string>;
  readonly price_indication: string;
  readonly pdf_artifact_ref: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeBuyerBrochure(input: BuyerBrochureInput): ComposedAsset {
  requireCitations(input.citations, 2);
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);

  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `# Parcel ${input.parcel_id}`,
    '',
    `**Ore grade:** ${input.ore_grade}`,
    '',
    `## Assay summary`,
    input.assay_summary,
    '',
    `## Provenance chain`,
    ...input.provenance_chain.map((p) => `- ${p}`),
    '',
    `## Price indication`,
    input.price_indication,
  ].join('\n');

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'buyer_brochure',
    channel: 'email',
    variant_id: input.variant_id,
    body,
    attachments: [
      Object.freeze({
        part: 'brochure_pdf',
        mime_type: 'application/pdf',
        checksum: input.pdf_artifact_ref,
        artifact_ref: input.pdf_artifact_ref,
      }),
    ],
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
