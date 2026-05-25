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

function readStoredLanguage(fallback: Language): Language {
  if (typeof window === 'undefined') return fallback;
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

export function useWidgetLanguage(defaultLanguage: Language = 'en'): UseWidgetLanguageResult {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);

  useEffect(() => {
    setLanguageState(readStoredLanguage(defaultLanguage));
  }, [defaultLanguage]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // ignore
      }
      writeCookie(COOKIE_KEY, lang);
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'sw' : 'en');
  }, [language, setLanguage]);

  return { language, setLanguage, toggleLanguage };
}
