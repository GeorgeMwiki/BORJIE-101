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

export type Locale = 'en' | 'sw';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'borjie_locale';

/**
 * Read the locale from `document.cookie`. Returns the project default
 * when the cookie is missing or malformed. SSR-safe (returns default on
 * the server). Never mixes languages — only ever returns one.
 */
export function readLocaleFromDocument(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`),
  );
  if (!match) return DEFAULT_LOCALE;
  const value = decodeURIComponent(match[1]!);
  return value === 'sw' || value === 'en' ? value : DEFAULT_LOCALE;
}

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

/**
 * Pick one of two locale-strict variants. Never returns a concatenated
 * "EN / SW" string — that is the bug this helper exists to prevent.
 */
export function pickByLocale<T>(
  locale: Locale,
  variants: { readonly en: T; readonly sw: T },
): T {
  return locale === 'sw' ? variants.sw : variants.en;
}
