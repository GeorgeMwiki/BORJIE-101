/**
 * sitemap.xml builder — pure XML construction.
 *
 * The marketing studio composes a sitemap entry per published landing
 * page or SEO article. The caller assembles the full file by appending
 * the per-recipe entries to the global sitemap.
 */

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod: string;
  readonly changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly priority: number;
}

export function buildSitemapEntry(args: {
  readonly url: string;
  readonly last_modified_iso: string;
  readonly changefreq?: SitemapEntry['changefreq'];
  readonly priority?: number;
}): SitemapEntry {
  return Object.freeze({
    loc: args.url,
    lastmod: args.last_modified_iso,
    changefreq: args.changefreq ?? 'weekly',
    priority: args.priority ?? 0.5,
  });
}

export function renderSitemapXml(entries: ReadonlyArray<SitemapEntry>): string {
  const items = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${escapeXml(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
