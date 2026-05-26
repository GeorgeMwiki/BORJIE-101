import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './i18n';

/**
 * Server-side locale resolver. Reads the `borjie_locale` cookie and
 * returns a typed Locale; falls back to Swahili (the default) if the
 * cookie is missing or holds an unknown value.
 *
 * Next 15 made `cookies()` an async API — this helper hides that detail
 * from page components so they can `const locale = await getLocale()`.
 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const value = jar.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
