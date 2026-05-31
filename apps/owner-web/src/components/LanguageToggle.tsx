'use client';

import { useEffect, useState } from 'react';
import { LOCALE_COOKIE, readLocaleFromDocument, type Locale } from '@/lib/locale';

interface LanguageToggleProps {
  readonly initial: Locale;
}

/**
 * Swahili / English toggle.
 *
 * The toggle is the only UI that writes the active language. On click it
 * persists the `borjie_locale` cookie (one year, root path) and reloads
 * so the server layout, session, and every downstream surface pick up
 * the new locale together — the absolute-toggle rule (zero EN/SW mixing).
 *
 * Presented as a two-position pill so the active language is always
 * visible (vs. a hidden dropdown). Active state is seeded from the
 * current cookie via `readLocaleFromDocument()` so the pill reflects
 * reality after hydration even if the `initial` prop drifts; `initial`
 * is the SSR default that avoids a flash before the cookie is read.
 */
export function LanguageToggle({ initial }: LanguageToggleProps) {
  const [lang, setLang] = useState<Locale>(initial);

  // After hydration, reconcile with the actual cookie. `document` is
  // unavailable during SSR, so this only ever runs client-side.
  useEffect(() => {
    setLang(readLocaleFromDocument());
  }, []);

  function selectLocale(next: Locale) {
    if (next === lang) return;
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${LOCALE_COOKIE}=${next}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <div className="inline-flex rounded-full border border-border bg-surface p-0.5 text-xs">
      <button
        type="button"
        onClick={() => selectLocale('sw')}
        aria-pressed={lang === 'sw'}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          lang === 'sw'
            ? 'bg-foreground text-background'
            : 'text-neutral-400 hover:text-foreground'
        }`}
      >
        SW
      </button>
      <button
        type="button"
        onClick={() => selectLocale('en')}
        aria-pressed={lang === 'en'}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          lang === 'en'
            ? 'bg-foreground text-background'
            : 'text-neutral-400 hover:text-foreground'
        }`}
      >
        EN
      </button>
    </div>
  );
}
