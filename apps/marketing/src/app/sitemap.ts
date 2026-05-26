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
 * Next 15 server-emitted sitemap. Lists the 6 crawlable surfaces that
 * exist today on the marketing site. As docs sub-pages land they'll be
 * folded in here so the search engines see them on the next crawl.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/pilot`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
