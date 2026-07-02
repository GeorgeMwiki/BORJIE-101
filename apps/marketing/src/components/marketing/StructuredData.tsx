import { getLocale } from '@/lib/locale';

/**
 * Server-rendered entity @graph (Organization + WebSite) for the Borjie
 * marketing surface (SEO-L7).
 *
 * Rendered as a plain <script type="application/ld+json"> from an RSC so it is
 * in the INITIAL server HTML — AI crawlers execute zero JavaScript, so a
 * client-injected graph is invisible to them (SEO-L2). One @graph with stable
 * @id URIs (WebSite.publisher references the Organization node) so the two
 * nodes form one knowledge-graph entity, not scattered blobs.
 *
 * The graph carries ONLY honest, verifiable identity: no invented ratings,
 * counts, or metrics — schema that does not mirror the visible truth is a
 * structured-data policy violation. `inLanguage` mirrors the page locale
 * resolved server-side (the `/sw` URL header wins over the cookie), so the
 * Swahili surface advertises `sw` to crawlers.
 *
 * @module components/marketing/StructuredData
 */

function resolveSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_MARKETING_SITE_URL must be set in production marketing builds.',
    );
  }
  return 'https://borjie.co.tz';
}

const BASE_URL = resolveSiteUrl();
const ORG_ID = `${BASE_URL}/#organization`;
const WEBSITE_ID = `${BASE_URL}/#website`;

interface GraphNode {
  readonly [key: string]: unknown;
}

/**
 * Honest, glossary-consistent Organization description per active locale. The
 * @graph advertises `inLanguage: locale`, so an English sentence sitting under a
 * `/sw` graph is a zero-mix seam AI crawlers read verbatim — the description
 * must match the page's own language. Both carry the SAME domain-true identity
 * (mining-estate OS, TZ + pan-African, Mr. Mwikila brain layer, the six core
 * capabilities). No invented metrics, ratings, or counts.
 */
const ORG_DESCRIPTION: Record<string, string> = {
  en: 'An AI-native mining estate operating system for Tanzanian and pan-African mining — licences, royalty, workforce, treasury, compliance, and marketplace, orchestrated end to end.',
  sw: 'Mfumo wa uendeshaji wa mashamba ya migodi wenye akili bandia kwa migodi ya Tanzania na Afrika — leseni, mrabaha, wafanyakazi, hazina, uzingatiaji na soko, vinavyoendeshwa mwanzo hadi mwisho.',
};

/**
 * Honest identity @graph. Description is domain-true (mining-estate OS, TZ
 * launch, bilingual) in the ACTIVE locale; `areaServed` reflects the launch
 * beachhead + region; `knowsLanguage` is the real bilingual pair. No metrics,
 * ratings, or counts.
 */
export function buildGraph(locale: string): GraphNode {
  const description = ORG_DESCRIPTION[locale] ?? ORG_DESCRIPTION.en;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: 'Borjie',
        url: BASE_URL,
        description,
        logo: {
          '@type': 'ImageObject',
          url: `${BASE_URL}/favicon.svg`,
        },
        areaServed: [
          { '@type': 'Country', name: 'Tanzania' },
          { '@type': 'Place', name: 'East Africa' },
        ],
        knowsLanguage: ['en', 'sw'],
        sameAs: [] as string[],
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: 'Borjie',
        url: BASE_URL,
        inLanguage: locale,
        publisher: { '@id': ORG_ID },
      },
    ],
  };
}

export async function StructuredData() {
  // Locale resolves from the `/sw` URL header first, then the cookie — so the
  // @graph's inLanguage mirrors what the page actually renders.
  const locale = await getLocale();

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD must be a raw script per schema.org + Next.js JSON-LD guidance; content is JSON.stringify of a server-built literal, no user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(buildGraph(locale)) }}
    />
  );
}
