import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sitemap, { SEGMENT_SLUGS, withAlternates } from '../sitemap';

/**
 * SEO-L8 guards for the marketing sitemap:
 *  - COVERAGE: every live `/for-*` route on disk is listed in SEGMENT_SLUGS
 *    (and vice-versa) so the sitemap never silently drifts from the filesystem.
 *  - NO FABRICATED lastmod: no entry carries a `lastModified` — static routes
 *    have no real content date, and emitting `new Date()` is the unreliable
 *    signal Google learns to ignore.
 *  - hreflang alternates: every entry advertises en + sw + x-default so the
 *    Swahili `/sw` surface is discoverable.
 */
const APP_DIR = join(__dirname, '..');

function forRoutesOnDisk(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('for-'))
    .filter((e) => existsSync(join(APP_DIR, e.name, 'page.tsx')))
    .map((e) => e.name)
    .sort();
}

describe('sitemap coverage vs filesystem (SEO-L8 / S-8)', () => {
  it('lists exactly the /for-* routes that exist on disk', () => {
    const onDisk = forRoutesOnDisk();
    const declared = [...SEGMENT_SLUGS].sort();
    expect(declared).toEqual(onDisk);
  });
});

describe('sitemap SEO correctness', () => {
  const entries = sitemap();

  it('never fabricates a lastModified on any entry', () => {
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it('gives every entry en/sw/x-default hreflang alternates', () => {
    for (const entry of entries) {
      const langs = entry.alternates?.languages;
      expect(langs).toBeDefined();
      expect(langs).toHaveProperty('en');
      expect(langs).toHaveProperty('sw');
      expect(langs).toHaveProperty('x-default');
    }
  });

  it('covers the home route and every /for-* segment', () => {
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith('borjie.co.tz'))).toBe(true);
    for (const slug of SEGMENT_SLUGS) {
      expect(urls.some((u) => u.endsWith(`/${slug}`))).toBe(true);
    }
  });
});

describe('withAlternates', () => {
  it('maps the home path to a bare /sw swahili alternate', () => {
    const { languages } = withAlternates('');
    expect(languages.sw?.endsWith('/sw')).toBe(true);
    expect(languages['x-default']).toBe(languages.en);
  });

  it('prefixes a sub-path with /sw for the swahili alternate', () => {
    const { languages } = withAlternates('/for-pml');
    expect(languages.sw?.endsWith('/sw/for-pml')).toBe(true);
    expect(languages.en?.endsWith('/for-pml')).toBe(true);
  });
});
