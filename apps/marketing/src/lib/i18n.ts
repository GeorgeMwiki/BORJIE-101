import sw from '@/i18n/sw.json';
import en from '@/i18n/en.json';

/**
 * Lightweight i18n helper.
 *
 * Borjie marketing is bilingual sw/en. Swahili is the default; English
 * is opt-in via the `borjie_locale` cookie. We avoid pulling in
 * next-intl/i18next to keep the marketing bundle slim — the strings live
 * in two JSON dictionaries and a single `t()` helper resolves dotted
 * paths.
 */

export type Locale = 'sw' | 'en';

export const DEFAULT_LOCALE: Locale = 'sw';

export const LOCALE_COOKIE = 'borjie_locale';

export type Messages = typeof sw;

const dictionaries: Record<Locale, Messages> = {
  sw,
  en: en as Messages,
};

/**
 * Look up a nested message path against the dictionary. Falls back to
 * the path itself if a key is missing — that surfaces typos immediately
 * during dev without crashing the page render.
 */
export function getMessages(locale: Locale): Messages {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

export function isLocale(value: unknown): value is Locale {
  return value === 'sw' || value === 'en';
}
