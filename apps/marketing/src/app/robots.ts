import type { MetadataRoute } from 'next';

/**
 * Marketing-site canonical base URL. Reads
 * `NEXT_PUBLIC_MARKETING_SITE_URL` so preview deploys (Vercel branches)
 * emit a robots.txt pointing at their preview origin.
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
 * Next 15 server-emitted robots.txt. Public marketing is fully
 * crawlable; we disallow API routes so search engines never index the
 * pilot-apply form action.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
