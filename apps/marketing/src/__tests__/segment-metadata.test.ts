import { describe, expect, it } from 'vitest';
import {
  buildSegmentMetadata,
  alternateLanguages,
  TITLE_MAX,
  DESCRIPTION_MAX,
} from '@/components/marketing/segment-metadata';
import { getMessages, type Locale } from '@/lib/i18n';
import { SEGMENT_SLUGS } from '@/app/sitemap';

/**
 * SEO-L1/L3 guards for per-route metadata:
 *  - each route resolves a UNIQUE canonical (not the homepage) + en/sw/x-default
 *    hreflang alternates;
 *  - the OG card carries the active-locale token + the same title/description;
 *  - the real audience-page i18n copy stays within Google's title/description
 *    length limits in BOTH locales (SEO title/description truncation).
 */

const SLUG_TO_KEY: Record<string, keyof ReturnType<typeof getMessages>['audiencePages']> = {
  'for-pml': 'pml',
  'for-ml': 'ml',
  'for-sml': 'sml',
  'for-off-taker': 'offTaker',
  'for-cooperatives': 'cooperatives',
  'for-csr-community': 'csrCommunity',
  'for-regulator': 'regulator',
  'for-investor': 'investor',
  'for-bank': 'bank',
  'for-family-office': 'familyOffice',
};

describe('buildSegmentMetadata', () => {
  it('produces a per-route canonical, not the homepage', () => {
    const meta = buildSegmentMetadata({
      path: '/for-pml',
      locale: 'en',
      title: 'T',
      description: 'D',
    });
    expect(String(meta.alternates?.canonical)).toMatch(/\/for-pml$/);
    expect(String(meta.alternates?.canonical)).not.toMatch(/borjie\.co\.tz$/);
  });

  it('advertises en/sw/x-default hreflang + a localized OG card', () => {
    const meta = buildSegmentMetadata({
      path: '/for-ml',
      locale: 'sw',
      title: 'Kichwa',
      description: 'Maelezo',
    });
    const langs = meta.alternates?.languages ?? {};
    expect(langs).toHaveProperty('en');
    expect(langs).toHaveProperty('sw');
    expect(langs).toHaveProperty('x-default');
    expect(meta.openGraph?.locale).toBe('sw_TZ');
    expect(String((meta.openGraph as { url?: string }).url)).toMatch(/\/for-ml$/);
  });
});

describe('alternateLanguages', () => {
  it('points sw at the /sw-prefixed URL and x-default at en', () => {
    const langs = alternateLanguages('/for-bank');
    expect(langs.sw?.endsWith('/sw/for-bank')).toBe(true);
    expect(langs['x-default']).toBe(langs.en);
  });
});

describe('audience-page SEO copy stays within length limits (both locales)', () => {
  const locales: Locale[] = ['en', 'sw'];
  for (const slug of SEGMENT_SLUGS) {
    const key = SLUG_TO_KEY[slug];
    it(`${slug}: title ≤${TITLE_MAX}, description ≤${DESCRIPTION_MAX}`, () => {
      expect(key, `SLUG_TO_KEY must map ${slug}`).toBeDefined();
      if (!key) return;
      for (const locale of locales) {
        const t = getMessages(locale).audiencePages[key];
        expect(t.metaTitle.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(t.metaDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }
    });
  }
});
