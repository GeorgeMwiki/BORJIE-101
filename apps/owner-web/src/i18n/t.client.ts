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

import { useLocale } from '@/lib/locale';
import { dictionaries } from './dictionaries';
import { makeT, type TFn } from './resolve';

export function useT(): TFn {
  const locale = useLocale();
  return useMemo(() => makeT(dictionaries[locale]), [locale]);
}
