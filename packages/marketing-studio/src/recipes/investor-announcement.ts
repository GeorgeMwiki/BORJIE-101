/**
 * Seed recipe — Investor Announcement (Tier 2).
 *
 * Multi-channel: LinkedIn organic + X thread + YouTube Short +
 * email + landing page + press release. Audience segment:
 * institutional_investor.
 *
 * Reference implementation — the LLM `compose_campaign_v1` tool will
 * generate variations of this on demand.
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
import { composeSocialThread } from '../composers/social-thread.js';
import { composeShortVideo } from '../composers/short-video.js';
import { composeEmailCampaign } from '../composers/email.js';
import { composeLandingPage } from '../composers/landing-page.js';
import { composePressRelease } from '../composers/press-release.js';
import { buildMarketingAuditLink } from '../audit/audit-chain-link.js';

const ID = 'investor_announcement';
const VERSION = 1;

const ASSETS: ReadonlyArray<CampaignAsset> = Object.freeze([
  Object.freeze({
    id: 'linkedin-organic-post',
    class: 'social_post_single' as const,
    channel: 'linkedin_organic' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'investor_announcement.li' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
  Object.freeze({
    id: 'x-thread',
    class: 'social_thread' as const,
    channel: 'x_organic' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'investor_announcement.x' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
  Object.freeze({
    id: 'youtube-short',
    class: 'short_video_spot' as const,
    channel: 'youtube_organic' as const,
    recipe_ref: { kind: 'media' as const, id: 'investor_brand_video' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
  Object.freeze({
    id: 'email-blast',
    class: 'email_campaign' as const,
    channel: 'email' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'investor_announcement.email' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
  Object.freeze({
    id: 'landing-page',
    class: 'landing_page' as const,
    channel: 'web_landing' as const,
    recipe_ref: { kind: 'marketing' as const, id: 'investor_announcement.lp' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
  Object.freeze({
    id: 'press-release',
    class: 'press_release' as const,
    channel: 'pr_wire' as const,
    recipe_ref: { kind: 'document' as const, id: 'investor_briefing' },
    variant_count: 1,
    publish_authority_tier: 2 as const,
  }),
]);

export const investorAnnouncementRecipe: CampaignRecipe = Object.freeze({
  id: ID,
  version: VERSION,
  status: 'live',
  assets: ASSETS,
  sequencing: 'cascading',
  audience_segments: Object.freeze<AudienceSegment[]>(['institutional_investor', 'mining_journalist']),
  ab_testing: null,
  success_metrics: Object.freeze([
    { kind: 'ctr' as const, threshold: 0.04, window_days: 7 },
    { kind: 'conversion_rate' as const, threshold: 0.02, window_days: 14 },
  ]),
  compliance: Object.freeze({
    claims_must_cite: true,
    forbidden_phrases: Object.freeze([...DEFAULT_FORBIDDEN_PHRASES]),
    required_disclaimers: Object.freeze([...DEFAULT_REQUIRED_DISCLAIMERS]),
    geo_restrictions: Object.freeze<string[]>(['US', 'EU']),
  }),
  authority_tier: 2,
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
      authority_tier: 2,
      publish_authority_tier: 2,
      channel: 'linkedin_organic',
      variant_id: 'li-v0',
      headline: 'Borjie pilot results',
      body: `We released pilot results today, with a strong production lift [cite:bot-2025-q3]. ${disclaimerLine}`,
      cta: 'Read the brief at https://borjie.co.tz/investor-brief',
      citations: ctx.citations,
      generated_at,
    });
    const thread = composeSocialThread({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
      publish_authority_tier: 2,
      channel: 'x_organic',
      variant_id: 'x-v0',
      segments: Object.freeze([
        'Pilot complete. Strong lift confirmed [cite:bot-2025-q3].',
        disclaimerLine,
      ]),
      citations: ctx.citations,
      generated_at,
    });
    const short = composeShortVideo({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
      publish_authority_tier: 2,
      channel: 'youtube_organic',
      variant_id: 'yt-v0',
      caption: `Pilot recap [cite:bot-2025-q3]. ${disclaimerLine}`,
      duration_sec: 30,
      video_artifact_ref: 'media-ref-placeholder',
      citations: ctx.citations,
      generated_at,
    });
    const email = composeEmailCampaign({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'email-v0',
      subject: 'Borjie Q3 pilot results',
      preheader: 'Pilot complete; 13% lift.',
      html_body:
        '<p>Borjie pilot complete with 13% YoY lift in 2025 [cite:bot-2025-q3].</p><p>Past performance does not predict future results. This is not investment advice.</p>',
      plaintext_body:
        'Borjie pilot complete with 13% YoY lift in 2025 [cite:bot-2025-q3]. Past performance does not predict future results. This is not investment advice.',
      citations: ctx.citations,
      generated_at,
    });
    const lp = composeLandingPage({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'lp-v0',
      url: 'https://borjie.co.tz/campaigns/investor-announcement',
      title: 'Pilot Results — Investor Update',
      description: 'Borjie has released its latest pilot performance summary [cite:bot-2025-q3]. Past performance does not predict future results. This is not investment advice.',
      body_html:
        '<main><h1>Pilot Results</h1><p>Strong pilot performance confirmed [cite:bot-2025-q3].</p><p>Past performance does not predict future results. This is not investment advice.</p></main>',
      breadcrumbs: Object.freeze([
        { name: 'Home', url: 'https://borjie.co.tz' },
        { name: 'Investors', url: 'https://borjie.co.tz/investors' },
      ]),
      citations: ctx.citations,
      generated_at,
    });
    const pr = composePressRelease({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'pr-v0',
      dateline: 'Dar es Salaam, Tanzania',
      headline: 'Borjie Releases Latest Pilot Results',
      lead_paragraph: 'Borjie today released its latest pilot performance results [cite:bot-2025-q3]. Past performance does not predict future results. This is not investment advice.',
      body_paragraphs: Object.freeze([
        'Past performance does not predict future results.',
        'This is not investment advice.',
      ]),
      boilerplate: 'Borjie is a Tanzania-based mining operations AI platform.',
      media_contact: Object.freeze({
        name: 'Borjie Media',
        email: 'media@borjie.co.tz',
      }),
      citations: ctx.citations,
      generated_at,
    });
    const composed = Object.freeze([li, thread, short, email, lp, pr]);
    const aggLink = buildMarketingAuditLink({
      tenant_id: ctx.tenant_id,
      recipe_id: ID,
      recipe_version: VERSION,
      audience_segment: ctx.audience_segment,
      authority_tier: 2,
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
