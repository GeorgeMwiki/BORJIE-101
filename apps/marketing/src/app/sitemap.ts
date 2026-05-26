import type { MetadataRoute } from 'next';

const BASE = 'https://borjie.co.tz';

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
