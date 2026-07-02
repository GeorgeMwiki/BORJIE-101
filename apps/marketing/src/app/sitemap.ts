import type { MetadataRoute } from 'next';

/**
 * Marketing-site canonical base URL. Reads
 * `NEXT_PUBLIC_MARKETING_SITE_URL` so preview deploys (Vercel branches)
 * emit a sitemap pointing at their preview origin and production emits
 * the canonical `https://borjie.co.tz`.
 *
 * No silent localhost fallback: SEO artefacts must be deterministic.
 */
function resolveBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_MARKETING_SITE_URL must be set in production marketing builds.',
    );
  }
  return 'https://borjie.co.tz';
}

const BASE = resolveBase();

/**
 * Every audience-segment marketing route (/for-*). Kept in sync with the
 * filesystem by `src/app/__tests__/sitemap-coverage.test.ts` — a new
 * `/for-*` page fails CI until its slug is listed here, so the sitemap can
 * never silently drift from the routes.
 */
export const SEGMENT_SLUGS = [
  'for-pml',
  'for-ml',
  'for-sml',
  'for-off-taker',
  'for-cooperatives',
  'for-csr-community',
  'for-regulator',
  'for-investor',
  'for-bank',
  'for-family-office',
] as const;

/**
 * Non-segment public routes. Static routes carry NO `lastModified`: Google
 * uses lastmod for crawl scheduling only while it is verifiably truthful and
 * ignores it site-wide once it proves unreliable — emitting `new Date()` on
 * every build is exactly that unreliable signal (SEO-L8). A route gets a
 * lastModified only when a real content date exists (none here yet).
 */
const STATIC_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly priority: number;
  readonly changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
}> = [
  { path: '', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/pilot', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/buyers', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/docs', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/careers', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/blog', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/support', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/status', priority: 0.4, changeFrequency: 'daily' },
  { path: '/privacy', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/dpa', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/legal/privacy', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/legal/cookies', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/legal/subprocessors', priority: 0.4, changeFrequency: 'monthly' },
];

/**
 * hreflang alternates for a marketing route (SEO-L3). Each page has an `en` URL
 * (the shared/default URL), a Swahili `/sw` locale-prefixed URL, and an
 * `x-default` pointing at the shared URL — cross-linked so search engines index
 * both language versions and know the default for an unmatched locale.
 */
export function withAlternates(path: string): {
  languages: Record<string, string>;
} {
  const enUrl = `${BASE}${path}`;
  const swUrl = `${BASE}${path === '' ? '/sw' : `/sw${path}`}`;
  return {
    languages: {
      en: enUrl,
      sw: swUrl,
      'x-default': enUrl,
    },
  };
}

/**
 * Next 15 server-emitted sitemap. Lists the crawlable public surfaces with
 * en/sw/x-default hreflang alternates and no fabricated lastmod.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${BASE}${r.path}`,
    alternates: withAlternates(r.path),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const segmentEntries: MetadataRoute.Sitemap = SEGMENT_SLUGS.map((slug) => ({
    url: `${BASE}/${slug}`,
    alternates: withAlternates(`/${slug}`),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticEntries, ...segmentEntries];
}
