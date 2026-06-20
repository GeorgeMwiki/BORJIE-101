'use client';

/**
 * Client-side translator hook.
 *
 * Reads the same `borjie_locale` cookie the server resolver uses (via
 * `useLocale()`), then resolves keys against the static dictionaries.
 * Server and client therefore agree on the active language for a given
 * request, so a client component never re-renders into the other locale
 * after hydration.
 *
 * Use in Client Components:
 *
 *   const t = useT();
 *   return <button>{t('auth.signIn.submit')}</button>;
 */

import { useMemo } from 'react';

import { useLocale, type Locale } from '@/lib/locale';
import { dictionaries } from './dictionaries';
import { makeT, type TFn } from './resolve';

/**
 * `initialLocale` SEEDS the first render. A client component rendered by a
 * Server Component that already resolved the cookie via
 * `readLocaleFromServerCookies()` MUST pass it so SSR and the client's first
 * paint render the SAME, correct language — otherwise useLocale starts at
 * DEFAULT_LOCALE='en' and the post-hydration effect ticks a frame later,
 * producing the first-paint EN-under-an-SW-chrome split.
 */
export function useT(initialLocale?: Locale): TFn {
  const locale = useLocale(initialLocale);
  return useMemo(() => makeT(dictionaries[locale]), [locale]);
}
