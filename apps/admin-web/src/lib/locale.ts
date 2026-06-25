/**
 * Admin-web locale helper.
 *
 * Strict per-locale rendering — NEVER mix Swahili and English in one
 * rendered string. The operator's chosen locale (borjie_locale cookie /
 * settings toggle) is the single source of truth. Falls back to the
 * project default (English) when the cookie is absent or malformed.
 *
 * Usage:
 *
 *   const locale = useLocale()
 *   // render ONLY the active-locale field, never both simultaneously
 *
 * Mirrors apps/owner-web/src/lib/locale.ts — same cookie name, same
 * DEFAULT_LOCALE, same polling strategy.
 */

import { useContext, useEffect, useState } from 'react';

import { LocaleSeedContext } from './locale-context';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  readLocaleFromDocument,
  type Locale,
} from './locale-shared';

export type { Locale };
// Re-export the hook-free helpers so the many CLIENT importers of
// `@/lib/locale` keep working unchanged. Server Components must import these
// from `@/lib/locale-shared` directly (importing this file would drag the
// `useLocale` hook below into the server bundle — which Next rejects).
export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  readLocaleFromDocument,
  pickByLocale,
} from './locale-shared';

/**
 * React hook that subscribes to the active locale. Re-renders if the
 * cookie changes mid-session (e.g. the user flips the toggle).
 *
 * `initialLocale` SEEDS the first render. A client component rendered by a
 * Server Component that already resolved the cookie (via
 * `readLocaleFromServerCookies`) MUST pass it so SSR + the client's first
 * paint render the SAME, correct language — otherwise the hook defaults to
 * `en` until the post-hydration effect runs, producing a one-frame
 * EN-under-an-SW-header split (the zero-mix canon violation). Absent a seed
 * (a purely client surface) it falls back to the project default and the
 * effect below corrects it on mount.
 */
export function useLocale(initialLocale?: Locale): Locale {
  // Seed precedence: explicit prop > root server-seeded LocaleProvider
  // context > project default. The context seed makes an UNSEEDED
  // `useLocale()` paint the correct language on the first frame, app-wide.
  const seededLocale = useContext(LocaleSeedContext);
  const [locale, setLocale] = useState<Locale>(
    initialLocale ?? seededLocale ?? DEFAULT_LOCALE,
  );
  useEffect(() => {
    setLocale(readLocaleFromDocument());
    const interval = window.setInterval(() => {
      setLocale(readLocaleFromDocument());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  return locale;
}
