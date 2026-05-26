/**
 * SEO + audience-resolver tests.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBreadcrumbLd,
  buildNewsArticleLd,
  buildOrganizationLd,
  serializeJsonLd,
} from '../seo/json-ld-builder.js';
import { buildOgMeta } from '../seo/og-meta-builder.js';
import { buildSitemapEntry, renderSitemapXml } from '../seo/sitemap-injector.js';
import {
  buildSegmentPromptPrefix,
  SEGMENT_PROMPTS,
} from '../audience/segment-prompts.js';
import { resolveAudienceSegment } from '../audience/segment-resolver.js';

describe('json-ld', () => {
  it('builds Organization LD', () => {
    const org = buildOrganizationLd({ name: 'Borjie', url: 'https://borjie.co.tz' });
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toBe('Organization');
  });

  it('builds NewsArticle LD', () => {
    const org = buildOrganizationLd({ name: 'Borjie', url: 'https://borjie.co.tz' });
    const article = buildNewsArticleLd({
      headline: 'H',
      date_published: '2026-01-01T00:00:00.000Z',
      publisher: org,
    });
    expect(article['@type']).toBe('NewsArticle');
    expect(article.headline).toBe('H');
  });

  it('builds BreadcrumbList LD', () => {
    const breadcrumb = buildBreadcrumbLd([
      { name: 'Home', url: 'https://borjie.co.tz' },
      { name: 'Investors', url: 'https://borjie.co.tz/investors' },
    ]);
    expect(breadcrumb.itemListElement).toHaveLength(2);
    expect(breadcrumb.itemListElement[0]!.position).toBe(1);
  });

  it('serialises LD as a script tag', () => {
    const org = buildOrganizationLd({ name: 'Borjie', url: 'https://borjie.co.tz' });
    const s = serializeJsonLd(org);
    expect(s).toContain('application/ld+json');
    expect(s).toContain('"Borjie"');
  });
});

describe('og meta', () => {
  it('builds OG + Twitter card tags with image', () => {
    const meta = buildOgMeta({
      title: 'T',
      description: 'D',
      url: 'https://borjie.co.tz',
      image: 'https://borjie.co.tz/og.png',
    });
    expect(meta).toContain('og:title');
    expect(meta).toContain('twitter:card');
    expect(meta).toContain('summary_large_image');
  });

  it('escapes attribute injection', () => {
    const meta = buildOgMeta({
      title: 'T"<script>',
      description: 'D',
      url: 'https://borjie.co.tz',
    });
    expect(meta).not.toContain('"<script>');
    expect(meta).toContain('&quot;&lt;script');
  });
});

describe('sitemap', () => {
  it('renders an XML envelope', () => {
    const entries = [
      buildSitemapEntry({
        url: 'https://borjie.co.tz/a',
        last_modified_iso: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const xml = renderSitemapXml(entries);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('borjie.co.tz/a');
  });
});

describe('segment prompts', () => {
  it('has a prompt per segment', () => {
    for (const key of Object.keys(SEGMENT_PROMPTS)) {
      expect(SEGMENT_PROMPTS[key as keyof typeof SEGMENT_PROMPTS].length).toBeGreaterThan(20);
    }
  });

  it('merges multiple segments', () => {
    const merged = buildSegmentPromptPrefix(['institutional_investor', 'mining_journalist']);
    expect(merged.length).toBeGreaterThan(50);
    expect(merged).toContain('investor');
  });
});

describe('segment resolver', () => {
  it('honors explicit segment', () => {
    const seg = resolveAudienceSegment({
      owner_profile: { id: 'u', displayName: 'd', preferred_language: 'en' },
      explicit_segment: 'regulator',
    });
    expect(seg).toBe('regulator');
  });

  it('keyword-matches intent hint', () => {
    const seg = resolveAudienceSegment({
      owner_profile: { id: 'u', displayName: 'd', preferred_language: 'en' },
      intent_hint: 'we want to attract more buyers',
    });
    expect(seg).toBe('mineral_buyer');
  });

  it('falls back to general_public', () => {
    const seg = resolveAudienceSegment({
      owner_profile: { id: 'u', displayName: 'd', preferred_language: 'en' },
      intent_hint: 'something totally unrelated',
    });
    expect(seg).toBe('general_public');
  });
});
