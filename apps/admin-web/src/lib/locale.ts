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

import { useEffect, useState } from 'react';

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
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    setLocale(readLocaleFromDocument());
    const interval = window.setInterval(() => {
      setLocale(readLocaleFromDocument());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  return locale;
}
