/**
 * useWidgetLanguage — persistent EN/SW toggle.
 *
 * Priority: localStorage → cookie → defaultLanguage. Writes to both cookie
 * (for SSR/next-intl read-back) and localStorage (for fast client reads).
 */
import { useCallback, useEffect, useState } from 'react';
import type { Language } from '../chat-modes/types';

const STORAGE_KEY = 'bn.mwikila.language';
const COOKIE_KEY = 'bn_mwikila_lang';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === name) return decodeURIComponent(v ?? '');
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * App-wide page-locale cookie (single source of truth set by every Borjie
 * Next app's layout). The widget must FOLLOW it so it never renders English
 * UI on a Swahili page (the zero-mix canon) — an explicit per-widget toggle
 * (COOKIE_KEY below) still wins, but absent one the widget inherits the page.
 */
const PAGE_LOCALE_COOKIE = 'borjie_locale';

function readStoredLanguage(fallback: Language): Language {
  if (typeof window === 'undefined') return fallback;
  // The PAGE locale (`borjie_locale`) is the SINGLE SOURCE OF TRUTH — set by
  // every Borjie app's layout and by BOTH language toggles (header + this
  // widget). The widget ALWAYS follows it so the chat can never diverge from
  // the page (zero-mix canon: one absolute language everywhere).
  const pageLocale = readCookie(PAGE_LOCALE_COOKIE);
  if (pageLocale === 'en' || pageLocale === 'sw') return pageLocale;
  // Legacy widget-local keys — only consulted when no page locale exists
  // (e.g. an embedding that doesn't set `borjie_locale`).
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'sw') return stored;
  } catch {
    // ignore storage errors in privacy mode
  }
  const cookie = readCookie(COOKIE_KEY);
  if (cookie === 'en' || cookie === 'sw') return cookie;
  return fallback;
}

export interface UseWidgetLanguageResult {
  readonly language: Language;
  readonly setLanguage: (lang: Language) => void;
  readonly toggleLanguage: () => void;
}

export function useWidgetLanguage(
  defaultLanguage: Language = 'en',
  initialLocale?: Language,
): UseWidgetLanguageResult {
  // Zero-mix first-paint: when the host passes the server-resolved locale
  // (`initialLocale`), SEED the initial state from it so SSR and the first
  // client render agree — no EN flash on a SW page before the effect ticks.
  // Absent it, fall back to the prior post-mount cookie-read behaviour so
  // no-arg callers behave exactly as before.
  const [language, setLanguageState] = useState<Language>(
    initialLocale ?? defaultLanguage,
  );

  useEffect(() => {
    setLanguageState(readStoredLanguage(initialLocale ?? defaultLanguage));
  }, [defaultLanguage, initialLocale]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      // Drive the PAGE locale (single source of truth) so the WHOLE site —
      // not just this widget — switches; keep the legacy widget keys in sync.
      writeCookie(PAGE_LOCALE_COOKIE, lang);
      writeCookie(COOKIE_KEY, lang);
      try {
        window.localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    const next: Language = language === 'en' ? 'sw' : 'en';
    setLanguage(next);
    // Reload so the server re-renders the entire page (and this widget) in the
    // new locale. The chat toggle is a SITE-WIDE toggle, identical to the
    // header one — without the reload the page would stay in the old language
    // while only the widget switched (the exact mixing this prevents).
    if (typeof window !== 'undefined') window.location.reload();
  }, [language, setLanguage]);

  return { language, setLanguage, toggleLanguage };
}
