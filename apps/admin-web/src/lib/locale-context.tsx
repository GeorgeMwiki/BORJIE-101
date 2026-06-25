'use client';

/**
 * Root locale SEED context — the single "resolve once, propagate" source
 * for the active locale's FIRST PAINT.
 *
 * The server root layout resolves the locale from the `borjie_locale`
 * cookie (`readLocaleFromServerCookies`) and wraps the tree in
 * `<LocaleProvider value={locale}>`. Every client `useLocale()` then seeds
 * its first render from this context — so SSR and the first client paint
 * agree on the correct language with NO per-component `initialLocale`
 * threading, eliminating the one-frame EN-under-SW split-brain across the
 * whole console at once (the zero-mix canon's first-paint rule).
 *
 * An explicit `initialLocale` prop still wins (it is more specific than the
 * root seed); a component rendered OUTSIDE the provider reads `undefined`
 * and falls back to the project default exactly as before — so this is
 * purely additive and backward-compatible.
 */

import { createContext, type ReactNode } from 'react';

import { type Locale } from './locale-shared';

export const LocaleSeedContext = createContext<Locale | undefined>(undefined);

export function LocaleProvider({
  value,
  children,
}: {
  readonly value: Locale;
  readonly children: ReactNode;
}) {
  return (
    <LocaleSeedContext.Provider value={value}>
      {children}
    </LocaleSeedContext.Provider>
  );
}
