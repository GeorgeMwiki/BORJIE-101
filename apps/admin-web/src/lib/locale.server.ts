/**
 * Server-only locale resolver for the admin console.
 *
 * Single source of truth for the console's active language when a SERVER
 * component needs it (e.g. the root layout mounting always-on chrome like
 * the FeedbackButton pill). Resolves the `borjie_locale` cookie, falling
 * back to the project default (English) when it is absent or malformed.
 *
 * Kept in a dedicated `*.server.ts` file because `next/headers` is
 * server-only — importing it from `lib/locale.ts` (which exports the
 * `useLocale` client hook) would break the client bundle. Client code
 * reads the same cookie via `readLocaleFromDocument()` in `lib/locale.ts`.
 *
 * Mirrors apps/owner-web/src/lib/locale.server.ts — same cookie name, same
 * DEFAULT_LOCALE, same absolute-toggle guarantee (zero EN/SW mixing).
 */

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './locale';

export async function readLocaleFromServerCookies(): Promise<Locale> {
  const jar = await cookies();
  const value = jar.get(LOCALE_COOKIE)?.value;
  return value === 'sw' || value === 'en' ? value : DEFAULT_LOCALE;
}
