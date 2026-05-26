/**
 * Composer: Landing Page — class `landing_page`.
 *
 * Produces a Next.js-ready HTML body + JSON-LD + OG meta block. The
 * caller (typically `apps/marketing/` route generator) writes the
 * file to disk; this composer is pure.
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
import {
  buildBreadcrumbLd,
  buildNewsArticleLd,
  buildOrganizationLd,
  serializeJsonLd,
} from '../seo/json-ld-builder.js';
import { buildOgMeta } from '../seo/og-meta-builder.js';

export interface LandingPageInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly hero_image_url?: string;
  readonly body_html: string;
  readonly breadcrumbs: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeLandingPage(input: LandingPageInput): ComposedAsset {
  if (input.publish_authority_tier !== 2) {
    throw new MarketingError(
      'STATE_TRANSITION_REFUSED',
      `landing_page must be Tier 2; got tier ${input.publish_authority_tier}`,
      [String(input.publish_authority_tier)],
    );
  }
  requireCitations(input.citations, 2);

  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const org = buildOrganizationLd({
    name: 'Borjie',
    url: 'https://borjie.co.tz',
    logo: 'https://borjie.co.tz/brand/wordmark.svg',
  });
  const article = buildNewsArticleLd({
    headline: input.title,
    date_published: pinGeneratedAt(input.generated_at),
    publisher: org,
    main_entity_url: input.url,
  });
  const breadcrumb = buildBreadcrumbLd(input.breadcrumbs);

  const ogArgs: Parameters<typeof buildOgMeta>[0] = {
    title: input.title,
    description: input.description,
    url: input.url,
    site_name: 'Borjie',
    type: 'website',
  };
  if (input.hero_image_url !== undefined) {
    Object.assign(ogArgs, { image: input.hero_image_url });
  }
  const ogMeta = buildOgMeta(ogArgs);

  const html = `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <meta name="description" content="${escapeAttr(input.description)}" />
  ${ogMeta}
  ${serializeJsonLd(org)}
  ${serializeJsonLd(article)}
  ${serializeJsonLd(breadcrumb)}
</head>
<body>
${input.body_html}
</body>
</html>`;

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'landing_page',
    channel: 'web_landing',
    variant_id: input.variant_id,
    body: html,
    span_citations: input.citations,
    generated_at: pinGeneratedAt(input.generated_at),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
