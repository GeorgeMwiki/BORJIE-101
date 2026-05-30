'use client';

import { useTransition } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';

/**
 * LanguageToggle — sw ↔ en cookie switcher.
 *
 * The toggle writes a `borjie_locale` cookie (one year, root path) and
 * reloads so the server layout picks the new dictionary up. We use a
 * transition + router.refresh in older Next versions; with App Router
 * the cheapest correct thing is a hard reload because the entire layout
 * depends on the locale.
 */
export function LanguageToggle({ current }: { readonly current: Locale }) {
  const [isPending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === current) return;
    startTransition(() => {
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${LOCALE_COOKIE}=${next}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
      window.location.reload();
    });
  }

  return (
    <div
      role="group"
      aria-label="Language switcher"
      className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 font-mono text-pill uppercase tracking-widest"
    >
      {(['sw', 'en'] as const).map((code) => {
        const active = code === current;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            disabled={isPending}
            aria-pressed={active}
            className={[
              'rounded px-2 py-1 transition-colors duration-fast',
              active
                ? 'bg-signal-500 text-primary-foreground'
                : 'text-foreground/70 hover:text-foreground',
            ].join(' ')}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
