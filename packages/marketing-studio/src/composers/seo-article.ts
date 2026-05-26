/**
 * Composer: SEO Article — class `seo_article`.
 *
 * Produces a Markdown body + an HTML wrapper with JSON-LD. The
 * markdown body is what feeds RSS / WordPress / Sanity; the HTML is
 * what the search crawler sees.
 */

import type {
  AudienceSegment,
  AuthorityTier,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { buildSegmentPromptPrefix } from '../audience/segment-prompts.js';
import { buildComposedAsset, pinGeneratedAt, requireCitations } from './_helpers.js';
import {
  buildNewsArticleLd,
  buildOrganizationLd,
  serializeJsonLd,
} from '../seo/json-ld-builder.js';

export interface SeoArticleInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly variant_id: string;
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    readonly body: string;
  }>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly generated_at?: string;
}

export function composeSeoArticle(input: SeoArticleInput): ComposedAsset {
  requireCitations(input.citations, 2);
  const prefix = buildSegmentPromptPrefix([input.audience_segment]);
  const generated_at = pinGeneratedAt(input.generated_at);

  const md = [
    `<!--prompt:${prefix.slice(0, 200).replace(/-->/g, '')}-->`,
    `# ${input.title}`,
    '',
    `> ${input.summary}`,
    '',
    `_Published ${generated_at}_`,
    '',
    ...input.sections.flatMap((s) => [`## ${s.heading}`, '', s.body, '']),
    '## References',
    '',
    ...input.citations.map(
      (c) => `- **[${c.id}]** ${c.claim} — ${c.source.kind}:${c.source.ref}`,
    ),
  ].join('\n');

  const org = buildOrganizationLd({
    name: 'Borjie',
    url: 'https://borjie.co.tz',
  });
  const articleLd = buildNewsArticleLd({
    headline: input.title,
    date_published: generated_at,
    publisher: org,
    main_entity_url: input.url,
  });
  const combinedBody = `${md}\n\n${serializeJsonLd(articleLd)}`;

  return buildComposedAsset({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    audience_segment: input.audience_segment,
    authority_tier: input.authority_tier,
    publish_authority_tier: input.publish_authority_tier,
    cls: 'seo_article',
    channel: 'rss',
    variant_id: input.variant_id,
    body: combinedBody,
    span_citations: input.citations,
    generated_at,
  });
}
