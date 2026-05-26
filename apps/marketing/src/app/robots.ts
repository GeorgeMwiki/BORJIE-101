import type { MetadataRoute } from 'next';

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
    sitemap: 'https://borjie.co.tz/sitemap.xml',
    host: 'https://borjie.co.tz',
  };
}
