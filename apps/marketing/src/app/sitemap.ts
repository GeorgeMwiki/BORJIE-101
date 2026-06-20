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
 * Next 15 server-emitted sitemap. Lists the crawlable surfaces that
 * exist today on the marketing site, including the audience landing
 * pages reachable from the "Who we serve" nav menu. As docs sub-pages
 * land they'll be folded in here so the search engines see them on the
 * next crawl.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entry = (
    path: string,
    priority: number,
    freq: MetadataRoute.Sitemap[number]['changeFrequency'] = 'weekly',
  ): MetadataRoute.Sitemap[number] => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: freq,
    priority,
  });
  return [
    // Hero
    entry('/', 1.0, 'weekly'),

    // Primary product surfaces
    entry('/pricing', 0.9, 'weekly'),
    entry('/pilot', 0.9, 'weekly'),
    entry('/buyers', 0.9, 'weekly'),
    entry('/docs', 0.7, 'weekly'),

    // Audience landing pages — reachable from the "Who we serve" mega-menu
    entry('/for-pml', 0.7, 'monthly'),
    entry('/for-ml', 0.7, 'monthly'),
    entry('/for-sml', 0.7, 'monthly'),
    entry('/for-off-taker', 0.7, 'monthly'),
    entry('/for-cooperatives', 0.7, 'monthly'),
    entry('/for-csr-community', 0.6, 'monthly'),
    entry('/for-regulator', 0.6, 'monthly'),
    entry('/for-investor', 0.6, 'monthly'),
    entry('/for-bank', 0.6, 'monthly'),
    entry('/for-family-office', 0.6, 'monthly'),

    // Company
    entry('/about', 0.6, 'monthly'),
    entry('/contact', 0.6, 'monthly'),
    entry('/careers', 0.5, 'weekly'),
    entry('/blog', 0.7, 'weekly'),
    entry('/support', 0.5, 'monthly'),
    entry('/status', 0.4, 'daily'),

    // Legal
    entry('/privacy', 0.4, 'monthly'),
    entry('/terms', 0.4, 'monthly'),
    entry('/dpa', 0.4, 'monthly'),
    entry('/legal/privacy', 0.4, 'monthly'),
    entry('/legal/terms', 0.4, 'monthly'),
    entry('/legal/cookies', 0.4, 'monthly'),
    entry('/legal/subprocessors', 0.4, 'monthly'),
  ];
}
