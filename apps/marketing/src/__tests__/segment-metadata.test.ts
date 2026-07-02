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

/**
 * The non-segment public pages (pricing, about, contact, docs, buyers, the
 * legal set, …) that were migrated OFF a static hardcoded-English
 * `export const metadata` ONTO a locale-aware `generateMetadata` +
 * buildSegmentMetadata. Each `pageMeta.<key>` supplies the localized title +
 * description; the map's value is the route path the page passes to
 * buildSegmentMetadata, so the same table proves the canonical it resolves.
 */
const PAGE_META_ROUTES: ReadonlyArray<
  readonly [keyof ReturnType<typeof getMessages>['pageMeta'], string]
> = [
  ['pricing', '/pricing'],
  ['about', '/about'],
  ['contact', '/contact'],
  ['docs', '/docs'],
  ['buyers', '/buyers'],
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['dpa', '/dpa'],
  ['careers', '/careers'],
  ['support', '/support'],
  ['status', '/status'],
  ['pilot', '/pilot'],
  ['legalSubprocessors', '/legal/subprocessors'],
  ['legalPrivacy', '/legal/privacy'],
  ['legalCookies', '/legal/cookies'],
  ['legalTerms', '/legal/terms'],
];

describe('converted static-metadata pages: pageMeta SEO copy', () => {
  const locales: Locale[] = ['en', 'sw'];

  for (const [key, path] of PAGE_META_ROUTES) {
    it(`${key}: en/sw parity + title ≤${TITLE_MAX}, description ≤${DESCRIPTION_MAX} in both locales`, () => {
      for (const locale of locales) {
        const t = getMessages(locale).pageMeta[key];
        // parity: the key resolves a real, non-empty title/description in BOTH
        // locales — a missing sw key would fall to a placeholder, never to en.
        expect(t?.metaTitle, `${key} metaTitle missing in ${locale}`).toBeTruthy();
        expect(
          t?.metaDescription,
          `${key} metaDescription missing in ${locale}`,
        ).toBeTruthy();
        expect(t.metaTitle.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(t.metaDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }
    });

    it(`${key}: resolves the per-route canonical + en/sw/x-default hreflang (both locales)`, () => {
      for (const locale of locales) {
        const t = getMessages(locale).pageMeta[key];
        const meta = buildSegmentMetadata({
          path,
          locale,
          title: t.metaTitle,
          description: t.metaDescription,
        });
        // per-route canonical, not the homepage
        expect(String(meta.alternates?.canonical).endsWith(path)).toBe(true);
        expect(String(meta.alternates?.canonical)).not.toMatch(/borjie\.co\.tz$/);
        // full hreflang set + active-locale OG token (zero-mix SEO-L3)
        const langs = meta.alternates?.languages ?? {};
        expect(langs).toHaveProperty('en');
        expect(langs).toHaveProperty('sw');
        expect(langs).toHaveProperty('x-default');
        expect(meta.openGraph?.locale).toBe(locale === 'sw' ? 'sw_TZ' : 'en_US');
        expect(meta.title).toBe(t.metaTitle);
      }
    });
  }
});
