/**
 * Server-only locale resolver.
 *
 * This is the SINGLE source of truth for the cockpit's active language.
 * The server layout, the mock session, and every downstream
 * `languagePreference` consumer resolve their locale from here, so the
 * layout chrome and the dashboard / chat never disagree — honouring the
 * absolute-toggle rule (zero EN/SW mixing per page).
 *
 * Kept in a dedicated `*.server.ts` file because `next/headers` is
 * server-only — importing it from a module that client components also
 * pull in (`lib/locale.ts` exports the `useLocale` hook) would break the
 * client bundle. Client code reads the same cookie via
 * `readLocaleFromDocument()` in `lib/locale.ts`.
 *
 * Next 15 made `cookies()` async — this helper hides that so callers can
 * simply `await readLocaleFromServerCookies()`.
 */

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './locale-shared';

export async function readLocaleFromServerCookies(): Promise<Locale> {
  const jar = await cookies();
  const value = jar.get(LOCALE_COOKIE)?.value;
  return value === 'sw' || value === 'en' ? value : DEFAULT_LOCALE;
}
