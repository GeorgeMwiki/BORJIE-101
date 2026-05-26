/**
 * Composer: Email Campaign — class `email_campaign`.
 *
 * Produces HTML + plaintext parts. MJML rendering is deferred to the
 * channel adapter (we do not bundle MJML here — adapters can do their
 * own render or rely on Resend's MJML support).
 */

import type {
  AudienceSegment,
  AuthorityTier,
  Channel,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { MarketingError } from '../types.js';
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';

const SUBJECT_MAX = 78;

export interface EmailInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly subject: string;
  readonly preheader: string;
  readonly html_body: string;
  readonly plaintext_body: string;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeEmailCampaign(input: EmailInput): ComposedAsset {
  if (input.subject.length === 0) {
    throw new MarketingError('INPUT_GAP', 'subject required', []);
  }
  if (input.subject.length > SUBJECT_MAX) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `subject too long: ${input.subject.length} > ${SUBJECT_MAX}`,
      [String(input.subject.length)],
    );
  }
  requireCitations(input.citations, 1);
  const channel: Channel = 'email';
  // Hidden segment-prompt prefix is intentionally not embedded in the
  // email body to keep the compliance scanner focused on user-visible
  // copy only.
  const combined = JSON.stringify({
    subject: input.subject,
    preheader: input.preheader,
    html: input.html_body,
    plaintext: input.plaintext_body,
  });

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'email_campaign',
    channel,
    variant_id: input.variant_id,
    body: combined,
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}
