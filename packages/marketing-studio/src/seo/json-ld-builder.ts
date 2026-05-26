/**
 * schema.org JSON-LD builder — per spec §5.
 *
 * Pure functions returning structured-data blobs. Caller embeds
 * them into HTML `<script type="application/ld+json">` tags.
 */

export interface OrganizationLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'Organization';
  readonly name: string;
  readonly url: string;
  readonly logo?: string;
  readonly sameAs?: ReadonlyArray<string>;
}

export interface NewsArticleLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'NewsArticle';
  readonly headline: string;
  readonly datePublished: string;
  readonly author: {
    readonly '@type': 'Organization';
    readonly name: string;
  };
  readonly publisher: OrganizationLd;
  readonly mainEntityOfPage?: string;
}

export interface ProductLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'Product';
  readonly name: string;
  readonly description: string;
  readonly brand: {
    readonly '@type': 'Brand';
    readonly name: string;
  };
}

export interface BreadcrumbListLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'BreadcrumbList';
  readonly itemListElement: ReadonlyArray<{
    readonly '@type': 'ListItem';
    readonly position: number;
    readonly name: string;
    readonly item: string;
  }>;
}

export function buildOrganizationLd(args: {
  readonly name: string;
  readonly url: string;
  readonly logo?: string;
  readonly same_as?: ReadonlyArray<string>;
}): OrganizationLd {
  const base: OrganizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: args.name,
    url: args.url,
  };
  return Object.freeze({
    ...base,
    ...(args.logo !== undefined ? { logo: args.logo } : {}),
    ...(args.same_as !== undefined ? { sameAs: args.same_as } : {}),
  });
}

export function buildNewsArticleLd(args: {
  readonly headline: string;
  readonly date_published: string;
  readonly publisher: OrganizationLd;
  readonly main_entity_url?: string;
}): NewsArticleLd {
  const base: NewsArticleLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: args.headline,
    datePublished: args.date_published,
    author: { '@type': 'Organization', name: args.publisher.name },
    publisher: args.publisher,
  };
  if (args.main_entity_url !== undefined) {
    return Object.freeze({ ...base, mainEntityOfPage: args.main_entity_url });
  }
  return Object.freeze(base);
}

export function buildBreadcrumbLd(
  items: ReadonlyArray<{ readonly name: string; readonly url: string }>,
): BreadcrumbListLd {
  return Object.freeze({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) =>
      Object.freeze({
        '@type': 'ListItem' as const,
        position: i + 1,
        name: it.name,
        item: it.url,
      }),
    ),
  });
}

export function serializeJsonLd(blob: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(blob)}</script>`;
}
