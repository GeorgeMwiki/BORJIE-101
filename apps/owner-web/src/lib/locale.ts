/**
 * Owner-web locale helper.
 *
 * Strict per-locale rendering — NEVER mix Swahili and English in one
 * rendered string. The user's chosen locale (cookie / settings toggle)
 * is the single source of truth. If the cookie is unset, fall back to
 * the project default (English per the 2026-05 dev preference flip).
 *
 * Usage:
 *
 *   const lang = useLocale()
 *   const msg = pickByLocale(lang, { en: 'Hello', sw: 'Habari' })
 *
 * Or for one-off lookups outside React:
 *
 *   const lang = readLocaleFromDocument()
 *   const msg = pickByLocale(lang, { en: '…', sw: '…' })
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
export { DEFAULT_LOCALE, LOCALE_COOKIE, readLocaleFromDocument } from './locale-shared';
export { pickByLocale } from './locale-shared';

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
  // Seed precedence: an explicit prop (most specific) > the root
  // server-seeded LocaleProvider context > the project default. The context
  // seed is what makes an UNSEEDED `useLocale()` paint the correct language
  // on the first frame, app-wide, with no per-caller threading.
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
