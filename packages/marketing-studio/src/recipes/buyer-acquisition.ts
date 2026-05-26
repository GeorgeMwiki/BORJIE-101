/**
 * Seed recipe — Buyer Acquisition (Tier 1).
 *
 * Channels: LinkedIn organic + Meta organic + Email + Buyer brochure.
 * Audience segment: mineral_buyer.
 */

import { randomUUID } from 'node:crypto';
import type {
  AudienceSegment,
  CampaignArtifact,
  CampaignAsset,
  CampaignComposeContext,
  CampaignRecipe,
} from '../types.js';
import {
  DEFAULT_FORBIDDEN_PHRASES,
  DEFAULT_REQUIRED_DISCLAIMERS,
} from '../types.js';
import { composeSocialPostSingle } from '../composers/social-post.js';
import { composeEmailCampaign } from '../composers/email.js';
import { composeBuyerBrochure } from '../composers/buyer-brochure.js';
import { buildMarketingAuditLink } from '../audit/audit-chain-link.js';

const ID = 'buyer_acquisition';
const VERSION = 1;

const ASSETS: ReadonlyArray<CampaignAsset> = Object.freeze([
  Object.freeze({
    id: 'li-post',
    class: 'social_post_single' as const,
    channel: 'linkedin_organic' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'buyer_acquisition.li' },
    variant_count: 1,
    publish_authority_tier: 1 as const,
  }),
  Object.freeze({
    id: 'meta-post',
    class: 'social_post_single' as const,
    channel: 'meta_organic' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'buyer_acquisition.meta' },
    variant_count: 1,
    publish_authority_tier: 1 as const,
  }),
  Object.freeze({
    id: 'email-blast',
    class: 'email_campaign' as const,
    channel: 'email' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'buyer_acquisition.email' },
    variant_count: 1,
    publish_authority_tier: 1 as const,
  }),
  Object.freeze({
    id: 'brochure',
    class: 'buyer_brochure' as const,
    channel: 'email' as const,
    recipe_ref: { kind: 'document' as const, id: 'buyer_kyb_pack' },
    variant_count: 1,
    publish_authority_tier: 1 as const,
  }),
]);

export const buyerAcquisitionRecipe: CampaignRecipe = Object.freeze({
  id: ID,
  version: VERSION,
  status: 'live',
  assets: ASSETS,
  sequencing: 'parallel',
  audience_segments: Object.freeze<AudienceSegment[]>(['mineral_buyer']),
  ab_testing: null,
  success_metrics: Object.freeze([
    { kind: 'ctr' as const, threshold: 0.03, window_days: 14 },
    { kind: 'reply_rate' as const, threshold: 0.05, window_days: 14 },
  ]),
  compliance: Object.freeze({
    claims_must_cite: true,
    forbidden_phrases: Object.freeze([...DEFAULT_FORBIDDEN_PHRASES]),
    required_disclaimers: Object.freeze([...DEFAULT_REQUIRED_DISCLAIMERS]),
    geo_restrictions: Object.freeze([] as ReadonlyArray<string>),
  }),
  authority_tier: 1,
  brand: 'borjie',
  compose: async (ctx: CampaignComposeContext): Promise<CampaignArtifact> => {
    const generated_at = ctx.generated_at ?? new Date().toISOString();
    const disclaimerLine =
      'Past performance does not predict future results. This is not investment advice.';
    const li = composeSocialPostSingle({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 1,
      publish_authority_tier: 1,
      channel: 'linkedin_organic',
      variant_id: 'li-v0',
      headline: 'New parcel PRL-001 available',
      body: `New parcel PRL-001 — 18 g/t Au [cite:assay-001]. ${disclaimerLine}`,
      cta: 'Request a sample at https://borjie.co.tz/buyers',
      citations: ctx.citations,
      generated_at,
    });
    const meta = composeSocialPostSingle({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 1,
      publish_authority_tier: 1,
      channel: 'meta_organic',
      variant_id: 'meta-v0',
      headline: 'New parcel PRL-001 available',
      body: `New parcel PRL-001 — 18 g/t Au [cite:assay-001]. ${disclaimerLine}`,
      cta: 'Request a sample at https://borjie.co.tz/buyers',
      citations: ctx.citations,
      generated_at,
    });
    const email = composeEmailCampaign({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 1,
      publish_authority_tier: 1,
      variant_id: 'email-v0',
      subject: 'New parcel PRL-001',
      preheader: '18 g/t Au — Geita region',
      html_body:
        '<p>New parcel <strong>PRL-001</strong> — 18 g/t Au [cite:assay-001].</p><p>Past performance does not predict future results. This is not investment advice.</p>',
      plaintext_body:
        'New parcel PRL-001 — 18 g/t Au [cite:assay-001]. Past performance does not predict future results. This is not investment advice.',
      citations: ctx.citations,
      generated_at,
    });
    const brochure = composeBuyerBrochure({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 1,
      publish_authority_tier: 1,
      variant_id: 'br-v0',
      parcel_id: 'PRL-001',
      ore_grade: '18 g/t Au',
      assay_summary: `Independent assay confirms 18 g/t Au [cite:assay-001]. ${disclaimerLine}`,
      provenance_chain: Object.freeze([
        'Geita site, extraction July 2025 [cite:bot-2025-q3]',
      ]),
      price_indication: 'On request.',
      pdf_artifact_ref: 'doc-ref-placeholder',
      citations: ctx.citations,
      generated_at,
    });

    const composed = Object.freeze([li, meta, email, brochure]);
    const aggLink = buildMarketingAuditLink({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 1,
      channel: 'rss',
      variant_id: 'campaign-aggregate',
      checksum: composed.map((a) => a.audit_hash).join(','),
      span_citations: ctx.citations,
      generated_at,
    });
    return Object.freeze({
      id: randomUUID(),
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      assets: composed,
      audit_hash: aggLink.audit_hash,
      generated_at,
    });
  },
});
