import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './i18n';

/**
 * Request header the middleware sets on a `/sw/*` locale-prefixed marketing
 * request (MUST match `LOCALE_HEADER` in `src/middleware.ts`).
 *
 * A locale-prefixed URL is the crawler-visible source of truth for that
 * request's language, so it is read BEFORE the cookie. This is what makes the
 * Swahili `/sw/...` URLs render Swahili to a cookieless crawler (SEO-L3): the
 * homepage-cookie surface is invisible to bots because they send no cookie.
 */
export const LOCALE_HEADER = 'x-borjie-locale';

/**
 * Server-side locale resolver. Resolution order:
 *   1. `x-borjie-locale` request header (set by middleware for `/sw/*` URLs) —
 *      a locale-prefixed URL is the source of truth for that page's language.
 *   2. `borjie_locale` cookie (the shared-URL toggle for interactive sessions).
 *   3. English default (the 2026-05 preference flip) when neither is present or
 *      the value is unknown.
 *
 * Next 15 made `cookies()`/`headers()` async APIs — this helper hides that
 * detail from page components so they can `const locale = await getLocale()`.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const headerList = await headers();
    const fromHeader = headerList.get(LOCALE_HEADER);
    if (isLocale(fromHeader)) return fromHeader;
  } catch {
    /* request scope may be unavailable (e.g. static generation) */
  }
  const jar = await cookies();
  const value = jar.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
