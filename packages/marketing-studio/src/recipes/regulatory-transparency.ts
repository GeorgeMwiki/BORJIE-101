/**
 * Seed recipe — Regulatory Transparency (Tier 0).
 *
 * Doc-heavy. Internal only — auto-publish to owner; never reaches
 * public channels. Audience segment: regulator.
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
import { composeSeoArticle } from '../composers/seo-article.js';
import { composeEmailCampaign } from '../composers/email.js';
import { buildMarketingAuditLink } from '../audit/audit-chain-link.js';

const ID = 'regulatory_transparency';
const VERSION = 1;

const ASSETS: ReadonlyArray<CampaignAsset> = Object.freeze([
  Object.freeze({
    id: 'seo-article',
    class: 'seo_article' as const,
    channel: 'rss' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'regulatory_transparency.article' },
    variant_count: 1,
    publish_authority_tier: 0 as const,
  }),
  Object.freeze({
    id: 'regulator-brief-email',
    class: 'email_campaign' as const,
    channel: 'email' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'regulatory_transparency.email' },
    variant_count: 1,
    publish_authority_tier: 0 as const,
  }),
]);

export const regulatoryTransparencyRecipe: CampaignRecipe = Object.freeze({
  id: ID,
  version: VERSION,
  status: 'live',
  assets: ASSETS,
  sequencing: 'parallel',
  audience_segments: Object.freeze<AudienceSegment[]>(['regulator']),
  ab_testing: null,
  success_metrics: Object.freeze([
    { kind: 'engagement_rate' as const, threshold: 0.5, window_days: 30 },
  ]),
  compliance: Object.freeze({
    claims_must_cite: true,
    forbidden_phrases: Object.freeze([...DEFAULT_FORBIDDEN_PHRASES]),
    required_disclaimers: Object.freeze([...DEFAULT_REQUIRED_DISCLAIMERS]),
    geo_restrictions: Object.freeze([] as ReadonlyArray<string>),
  }),
  authority_tier: 0,
  brand: 'borjie',
  compose: async (ctx: CampaignComposeContext): Promise<CampaignArtifact> => {
    const generated_at = ctx.generated_at ?? new Date().toISOString();
    const article = composeSeoArticle({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 0,
      publish_authority_tier: 0,
      variant_id: 'art-v0',
      url: 'https://borjie.co.tz/transparency/latest',
      title: 'Quarterly Compliance Transparency',
      summary: 'Borjie publishes its latest audit-chain summary [cite:audit-q3]. Past performance does not predict future results. This is not investment advice.',
      sections: Object.freeze([
        {
          heading: 'Audit-chain integrity',
          body:
            'Across the latest quarter the chain verified all entries [cite:audit-q3]. Tumemadini certificates filed on time [cite:tumemadini-q3]. Past performance does not predict future results. This is not investment advice.',
        },
      ]),
      citations: ctx.citations,
      generated_at,
    });
    const email = composeEmailCampaign({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 0,
      publish_authority_tier: 0,
      variant_id: 'em-v0',
      subject: 'Compliance Snapshot',
      preheader: 'Internal — regulator-facing summary',
      html_body:
        '<p>Audit-chain integrity confirmed [cite:audit-q3]. Tumemadini certificates filed on time [cite:tumemadini-q3]. Past performance does not predict future results. This is not investment advice.</p>',
      plaintext_body:
        'Audit-chain integrity confirmed [cite:audit-q3]. Tumemadini certificates filed on time [cite:tumemadini-q3]. Past performance does not predict future results. This is not investment advice.',
      citations: ctx.citations,
      generated_at,
    });
    const composed = Object.freeze([article, email]);
    const aggLink = buildMarketingAuditLink({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 0,
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
