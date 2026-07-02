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

/** Private areas no crawler (search or AI) may index. */
const PRIVATE_DISALLOW = ['/api/'];

/**
 * Answer-engine + AI crawlers explicitly allowed on the public surface
 * (SEO-L5). The answer engines are a primary discovery channel now, and Bing
 * indexation (which allowing these bots gates) feeds ChatGPT. Blocking them —
 * or a blanket `*` disallow — would remove Borjie from every AI answer, so each
 * is allowed on public pages and held to the SAME private-area disallow as
 * every other crawler.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'PerplexityBot',
  'CCBot',
  'Google-Extended',
];

/**
 * Next 15 server-emitted robots.txt. Public marketing is fully
 * crawlable; we disallow API routes so search engines never index the
 * pilot-apply form action. AI crawlers are named explicitly (SEO-L5).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_DISALLOW,
      },
      // Allow each AI crawler on public pages, block the private areas — never a
      // blanket "/" disallow, which removes Borjie from AI search entirely.
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_DISALLOW,
      })),
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
