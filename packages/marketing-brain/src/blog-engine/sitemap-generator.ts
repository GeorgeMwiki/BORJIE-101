/**
 * Sitemap Generator — builds /sitemap.xml from post-store.
 *
 * Pure string builder. No I/O. Caller fetches posts, passes them in.
 */

import type { BlogPost } from './blog-post-types.js';

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod: string;
  readonly changefreq: 'daily' | 'weekly' | 'monthly';
  readonly priority: number;
}

function escape(xml: string): string {
  return xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function postsToSitemapEntries(
  posts: readonly BlogPost[],
  baseUrl: string,
): readonly SitemapEntry[] {
  return posts
    .filter((p) => p.publishedAt)
    .map((p) => ({
      loc: `${baseUrl.replace(/\/$/, '')}/blog/${encodeURIComponent(p.slug)}`,
      lastmod: p.updatedAt,
      changefreq: 'weekly',
      priority: 0.6,
    }));
}

export function generateSitemap(
  entries: readonly SitemapEntry[],
): string {
  const items = entries
    .map(
      (e) =>
        `  <url>\n` +
        `    <loc>${escape(e.loc)}</loc>\n` +
        `    <lastmod>${escape(e.lastmod)}</lastmod>\n` +
        `    <changefreq>${e.changefreq}</changefreq>\n` +
        `    <priority>${e.priority.toFixed(1)}</priority>\n` +
        `  </url>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${items}\n` +
    `</urlset>\n`
  );
}
