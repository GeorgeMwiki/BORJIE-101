import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n';

/**
 * Per-route metadata builder for the Borjie marketing surface (SEO-L1/L3).
 *
 * Every route must advertise its OWN canonical + hreflang alternates + OG/
 * twitter card — a layout-level canonical propagates the HOMEPAGE URL to every
 * sub-page, an SEO disaster. This helper produces a locale-correct, per-route
 * Metadata block from the route's path and its localized title/description, so
 * each `generateMetadata` stays a two-line call instead of hand-repeating the
 * alternates + OG wiring (and drifting).
 *
 * @module components/marketing/segment-metadata
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

const BASE = resolveSiteUrl();

/** Google truncates titles past ~60 chars and descriptions past ~160. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

/** OG `locale` tokens per active locale (no hardcoded BCP-47 in logic). */
const OG_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  sw: 'sw_TZ',
};

export interface SegmentMetadataInput {
  /** Route path, canonical form with a leading slash. Home is `''`. */
  readonly path: string;
  /** Active locale — resolved from the `/sw` URL header or the cookie. */
  readonly locale: Locale;
  /** Localized page title (rendered as-is; keep ≤60 chars per locale). */
  readonly title: string;
  /** Localized meta description (keep ≤160 chars per locale). */
  readonly description: string;
  /** Optional OG image path; defaults to the shared card. */
  readonly ogImage?: string;
}

/**
 * hreflang alternates for a route: `en` (shared URL), `sw` (`/sw`-prefixed),
 * and `x-default` (shared URL). Mirrors `sitemap.ts#withAlternates` so the two
 * surfaces advertise the same alternate URLs.
 */
export function alternateLanguages(path: string): Record<string, string> {
  const enUrl = `${BASE}${path}`;
  const swUrl = `${BASE}${path === '' ? '/sw' : `/sw${path}`}`;
  return { en: enUrl, sw: swUrl, 'x-default': enUrl };
}

/**
 * Build a per-route Metadata block with a unique canonical, en/sw/x-default
 * hreflang alternates, and localized OG + twitter cards.
 */
export function buildSegmentMetadata(input: SegmentMetadataInput): Metadata {
  const { path, locale, title, description } = input;
  const languages = alternateLanguages(path);
  // SELF-REFERENCING canonical per locale: a `/sw` page must canonicalize to
  // its OWN `/sw`-prefixed URL, not the shared EN URL. Pointing every `sw`
  // page's canonical at the EN URL contradicts its own hreflang and tells
  // Google to drop the entire `/sw` surface from the index. `en` (and any
  // non-sw locale) canonicalizes to the shared EN URL.
  const canonical = locale === 'sw' ? languages.sw : languages.en;
  const ogImage = input.ogImage ?? '/og-image.png';

  return {
    title,
    description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website',
      siteName: 'Borjie',
      locale: OG_LOCALE[locale],
      alternateLocale: locale === 'sw' ? [OG_LOCALE.en] : [OG_LOCALE.sw],
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}
