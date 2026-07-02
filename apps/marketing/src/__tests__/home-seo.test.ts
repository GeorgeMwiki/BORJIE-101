import { describe, expect, it } from 'vitest';
import { buildGraph } from '@/components/marketing/StructuredData';
import {
  buildSegmentMetadata,
  alternateLanguages,
  TITLE_MAX,
  DESCRIPTION_MAX,
} from '@/components/marketing/segment-metadata';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * SEO guards for the marketing HOMEPAGE (`/`) — the one route that carried no
 * generateMetadata, so it inherited the layout canonical and its `/sw` variant
 * self-canonicalized to `/` (de-indexing the whole Swahili surface) with no
 * hreflang. Also asserts the JSON-LD Organization description follows the active
 * locale (a zero-mix seam: the @graph advertises `inLanguage`).
 */

const locales: Locale[] = ['en', 'sw'];

describe('homepage pageMeta.home SEO copy', () => {
  it('en/sw parity + title ≤60, description ≤160 in both locales', () => {
    for (const locale of locales) {
      const t = getMessages(locale).pageMeta.home;
      expect(t?.metaTitle, `home metaTitle missing in ${locale}`).toBeTruthy();
      expect(
        t?.metaDescription,
        `home metaDescription missing in ${locale}`,
      ).toBeTruthy();
      expect(t.metaTitle.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(t.metaDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});

describe('homepage generateMetadata shape (path: "")', () => {
  it('sw self-canonicalizes to the /sw home + full hreflang set', () => {
    const t = getMessages('sw').pageMeta.home;
    const meta = buildSegmentMetadata({
      path: '',
      locale: 'sw',
      title: t.metaTitle,
      description: t.metaDescription,
    });
    const langs = meta.alternates?.languages ?? {};
    const canonical = String(meta.alternates?.canonical);
    // The SEO-L3 bug: sw home must canonicalize to its OWN /sw home, NOT `/`.
    expect(canonical.endsWith('/sw')).toBe(true);
    expect(canonical).toBe(String(langs.sw));
    // full hreflang set present + active-locale OG token.
    expect(langs).toHaveProperty('en');
    expect(langs).toHaveProperty('sw');
    expect(langs).toHaveProperty('x-default');
    expect(String(langs.sw).endsWith('/sw')).toBe(true);
    expect(String(langs['x-default'])).toBe(String(langs.en));
    expect(meta.openGraph?.locale).toBe('sw_TZ');
    expect(meta.title).toBe(t.metaTitle);
  });

  it('en home canonicalizes to the shared root URL with the same alternates', () => {
    const t = getMessages('en').pageMeta.home;
    const meta = buildSegmentMetadata({
      path: '',
      locale: 'en',
      title: t.metaTitle,
      description: t.metaDescription,
    });
    const langs = alternateLanguages('');
    const canonical = String(meta.alternates?.canonical);
    expect(canonical).toBe(langs.en);
    expect(canonical.includes('/sw')).toBe(false);
    expect(meta.openGraph?.locale).toBe('en_US');
  });
});

describe('JSON-LD Organization description follows the active locale (zero-mix)', () => {
  it('sw graph carries a Swahili description under inLanguage: sw', () => {
    const graph = buildGraph('sw') as {
      '@graph': ReadonlyArray<Record<string, unknown>>;
    };
    const org = graph['@graph'].find((n) => n['@type'] === 'Organization');
    const site = graph['@graph'].find((n) => n['@type'] === 'WebSite');
    expect(site?.inLanguage).toBe('sw');
    // Swahili identity words present; the English lead phrase absent.
    expect(String(org?.description)).toMatch(/akili bandia/);
    expect(String(org?.description)).not.toMatch(/AI-native mining estate/);
  });

  it('en graph carries the English description under inLanguage: en', () => {
    const graph = buildGraph('en') as {
      '@graph': ReadonlyArray<Record<string, unknown>>;
    };
    const org = graph['@graph'].find((n) => n['@type'] === 'Organization');
    const site = graph['@graph'].find((n) => n['@type'] === 'WebSite');
    expect(site?.inLanguage).toBe('en');
    expect(String(org?.description)).toMatch(/AI-native mining estate/);
    expect(String(org?.description)).not.toMatch(/akili bandia/);
  });
});
