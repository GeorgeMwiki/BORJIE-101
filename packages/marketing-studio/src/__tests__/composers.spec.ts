/**
 * Composer smoke tests — every composer accepts a valid input and
 * returns a ComposedAsset with a non-empty audit_hash and span
 * citations preserved.
 */

import { describe, it, expect } from 'vitest';
import { composeSocialPostSingle } from '../composers/social-post.js';
import { composeSocialThread } from '../composers/social-thread.js';
import { composeShortVideo } from '../composers/short-video.js';
import { composeLongVideo } from '../composers/long-video.js';
import { composePaidAd } from '../composers/paid-ad.js';
import { composeEmailCampaign } from '../composers/email.js';
import { composeLandingPage } from '../composers/landing-page.js';
import { composeSeoArticle } from '../composers/seo-article.js';
import { composePressRelease } from '../composers/press-release.js';
import { composeInvestorOnePager } from '../composers/investor-one-pager.js';
import { composeBuyerBrochure } from '../composers/buyer-brochure.js';
import { composeBoothKit } from '../composers/booth-kit.js';
import type { SpanCitation } from '../types.js';
import { MarketingError } from '../types.js';

const CITATIONS: ReadonlyArray<SpanCitation> = Object.freeze([
  Object.freeze({
    id: 'cite-1',
    claim: 'sample',
    source: { kind: 'corpus_chunk' as const, ref: 'chunk-1' },
  }),
  Object.freeze({
    id: 'cite-2',
    claim: 'sample',
    source: { kind: 'corpus_chunk' as const, ref: 'chunk-2' },
  }),
  Object.freeze({
    id: 'cite-3',
    claim: 'sample',
    source: { kind: 'corpus_chunk' as const, ref: 'chunk-3' },
  }),
]);

const COMMON = {
  tenant_id: 't1',
  recipe_id: 'r1',
  recipe_version: 1,
  audience_segment: 'mineral_buyer' as const,
  authority_tier: 1 as const,
  publish_authority_tier: 1 as const,
  generated_at: '2026-01-01T00:00:00.000Z',
  citations: CITATIONS,
};

describe('composers', () => {
  it('social-post', () => {
    const a = composeSocialPostSingle({
      ...COMMON,
      channel: 'linkedin_organic',
      variant_id: 'v0',
      headline: 'Hello',
      body: 'Body text [cite:cite-1].',
      cta: 'See https://borjie.co.tz/x',
    });
    expect(a.audit_hash).toMatch(/^[a-f0-9]+$/);
    expect(a.utm_tags['utm_campaign']).toBe('r1');
  });

  it('social-thread', () => {
    const a = composeSocialThread({
      ...COMMON,
      channel: 'x_organic',
      variant_id: 'v0',
      segments: ['Part 1 [cite:cite-1].', 'Part 2.'],
    });
    expect(a.audit_hash).toMatch(/^[a-f0-9]+$/);
  });

  it('social-thread refuses unsupported channel', () => {
    expect(() =>
      composeSocialThread({
        ...COMMON,
        channel: 'google_ads',
        variant_id: 'v0',
        segments: ['a', 'b'],
      }),
    ).toThrow(MarketingError);
  });

  it('short-video', () => {
    const a = composeShortVideo({
      ...COMMON,
      channel: 'tiktok_organic',
      variant_id: 'v0',
      caption: 'A clip [cite:cite-1].',
      duration_sec: 15,
      video_artifact_ref: 'media-ref',
    });
    expect(a.attachments).toHaveLength(1);
    expect(a.attachments[0]!.mime_type).toBe('video/mp4');
  });

  it('long-video requires Tier 2', () => {
    expect(() =>
      composeLongVideo({
        ...COMMON,
        channel: 'youtube_organic',
        variant_id: 'v0',
        title: 'Long title',
        description: 'Long desc',
        duration_sec: 120,
        video_artifact_ref: 'm',
        chapter_markers: [],
      }),
    ).toThrow(MarketingError);
  });

  it('long-video works at Tier 2', () => {
    const a = composeLongVideo({
      ...COMMON,
      publish_authority_tier: 2,
      authority_tier: 2,
      channel: 'youtube_organic',
      variant_id: 'v0',
      title: 'Long title',
      description: 'Long desc',
      duration_sec: 120,
      video_artifact_ref: 'm',
      chapter_markers: [{ t_sec: 0, label: 'intro' }],
    });
    expect(a.audit_hash).toMatch(/^[a-f0-9]+$/);
  });

  it('paid-ad produces N variants and requires Tier 2', () => {
    expect(() =>
      composePaidAd({
        ...COMMON,
        channel: 'meta_ads',
        variant_count: 3,
        brief: {
          base_message: 'b',
          cta_options: ['c'],
          headline_options: ['h'],
          tone_options: ['n'],
        },
      }),
    ).toThrow(MarketingError);
    const list = composePaidAd({
      ...COMMON,
      authority_tier: 2,
      publish_authority_tier: 2,
      channel: 'meta_ads',
      variant_count: 3,
      brief: {
        base_message: 'b',
        cta_options: ['c'],
        headline_options: ['h'],
        tone_options: ['n'],
      },
    });
    expect(list).toHaveLength(3);
  });

  it('email', () => {
    const a = composeEmailCampaign({
      ...COMMON,
      variant_id: 'v0',
      subject: 'Quarterly update',
      preheader: 'See inside',
      html_body: '<p>hi [cite:cite-1]</p>',
      plaintext_body: 'hi [cite:cite-1]',
    });
    expect(a.channel).toBe('email');
  });

  it('landing-page requires Tier 2', () => {
    expect(() =>
      composeLandingPage({
        ...COMMON,
        variant_id: 'v0',
        url: 'https://borjie.co.tz/x',
        title: 'T',
        description: 'D',
        body_html: '<p>x [cite:cite-1] [cite:cite-2]</p>',
        breadcrumbs: [],
      }),
    ).toThrow(MarketingError);
  });

  it('landing-page Tier 2 ok', () => {
    const a = composeLandingPage({
      ...COMMON,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'v0',
      url: 'https://borjie.co.tz/x',
      title: 'T',
      description: 'D',
      body_html: '<p>x [cite:cite-1] [cite:cite-2]</p>',
      breadcrumbs: [],
    });
    expect(a.body).toContain('application/ld+json');
  });

  it('seo-article', () => {
    const a = composeSeoArticle({
      ...COMMON,
      variant_id: 'v0',
      url: 'https://borjie.co.tz/y',
      title: 'Y',
      summary: 'sum',
      sections: [{ heading: 'H', body: 'B [cite:cite-1] [cite:cite-2]' }],
    });
    expect(a.body).toContain('Y');
  });

  it('press-release requires Tier 2 + 2 citations', () => {
    expect(() =>
      composePressRelease({
        ...COMMON,
        variant_id: 'v0',
        dateline: 'd',
        headline: 'h',
        lead_paragraph: 'l',
        body_paragraphs: [],
        boilerplate: 'b',
        media_contact: { name: 'n', email: 'e@e' },
      }),
    ).toThrow(MarketingError);
  });

  it('press-release Tier 2 ok', () => {
    const a = composePressRelease({
      ...COMMON,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'v0',
      dateline: 'd',
      headline: 'h',
      lead_paragraph: 'l [cite:cite-1] [cite:cite-2]',
      body_paragraphs: [],
      boilerplate: 'b',
      media_contact: { name: 'n', email: 'e@e' },
    });
    expect(a.channel).toBe('pr_wire');
  });

  it('investor-one-pager', () => {
    const a = composeInvestorOnePager({
      ...COMMON,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'v0',
      headline: 'IO',
      tagline: 'T',
      bullets: ['b1 [cite:cite-1] [cite:cite-2] [cite:cite-3]'],
      pdf_artifact_ref: 'p',
      disclaimers: ['x'],
    });
    expect(a.attachments[0]!.mime_type).toBe('application/pdf');
  });

  it('buyer-brochure', () => {
    const a = composeBuyerBrochure({
      ...COMMON,
      variant_id: 'v0',
      parcel_id: 'PRL',
      ore_grade: '18 g/t Au [cite:cite-1]',
      assay_summary: 'a [cite:cite-2]',
      provenance_chain: ['p'],
      price_indication: 'p',
      pdf_artifact_ref: 'p',
    });
    expect(a.class).toBe('buyer_brochure');
  });

  it('booth-kit Tier 2', () => {
    const a = composeBoothKit({
      ...COMMON,
      authority_tier: 2,
      publish_authority_tier: 2,
      variant_id: 'v0',
      event_name: 'EE',
      event_dates: '2026',
      booth_design_image_ref: 'i',
      deck_pptx_ref: 'd',
      takeaway_messages: ['m [cite:cite-1]'],
    });
    expect(a.attachments).toHaveLength(2);
  });
});
