/**
 * Server-side translator.
 *
 * Resolves the active locale from the `borjie_locale` cookie (the single
 * source of truth established in the Phase-0 locale unification) and
 * returns a bound `t(key, vars)` over that locale's dictionary. Because
 * the locale is resolved on the server, the first paint is already in
 * the correct language — no FOUC, no client-side language flip.
 *
 * Use in Server Components and route handlers:
 *
 *   const t = await getServerT();
 *   return <h1>{t('auth.signIn.heading')}</h1>;
 */

import 'server-only';

import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { dictionaries } from './dictionaries';
import { makeT, type TFn } from './resolve';

export async function getServerT(): Promise<TFn> {
  const locale = await readLocaleFromServerCookies();
  return makeT(dictionaries[locale]);
}
