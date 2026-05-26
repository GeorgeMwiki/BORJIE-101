/**
 * Composer: Press Release — class `press_release`.
 *
 * Produces a wire-format text body plus a reference to the underlying
 * DOCX / PDF artefact (composed by the document-templates layer). The
 * wire-format follows IPTC NewsML conventions: dateline, lead, body,
 * boilerplate, contact.
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

export interface PressReleaseInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly dateline: string;
  readonly headline: string;
  readonly lead_paragraph: string;
  readonly body_paragraphs: ReadonlyArray<string>;
  readonly boilerplate: string;
  readonly media_contact: {
    readonly name: string;
    readonly email: string;
    readonly phone?: string;
  };
  readonly docx_artifact_ref?: string;
  readonly pdf_artifact_ref?: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composePressRelease(input: PressReleaseInput): ComposedAsset {
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `press_release must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 2);

  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const body = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `FOR IMMEDIATE RELEASE`,
    input.dateline,
    '',
    input.headline.toUpperCase(),
    '',
    input.lead_paragraph,
    '',
    ...input.body_paragraphs,
    '',
    '### ABOUT BORJIE ###',
    input.boilerplate,
    '',
    'MEDIA CONTACT',
    `${input.media_contact.name}`,
    `${input.media_contact.email}`,
    ...(input.media_contact.phone !== undefined ? [input.media_contact.phone] : []),
  ].join('\n');

  const attachments: Array<{
    readonly part: string;
    readonly mime_type: string;
    readonly checksum: string;
    readonly artifact_ref: string;
  }> = [];
  if (input.docx_artifact_ref !== undefined) {
    attachments.push(
      Object.freeze({
        part: 'release_docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        checksum: input.docx_artifact_ref,
        artifact_ref: input.docx_artifact_ref,
      }),
    );
  }
  if (input.pdf_artifact_ref !== undefined) {
    attachments.push(
      Object.freeze({
        part: 'release_pdf',
        mime_type: 'application/pdf',
        checksum: input.pdf_artifact_ref,
        artifact_ref: input.pdf_artifact_ref,
      }),
    );
  }

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'press_release',
    channel: 'pr_wire',
    variant_id: input.variant_id,
    body,
    attachments,
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
