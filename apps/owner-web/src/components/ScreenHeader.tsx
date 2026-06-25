'use client';

import { getScreenBySlug } from '@/lib/screens';
import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import type { Locale } from '@/lib/locale-shared';

interface ScreenHeaderProps {
  readonly slug: string;
  /**
   * Server-resolved active locale. Seeds the first client render so SSR and
   * hydration agree (zero-mix canon: no EN-under-SW split-brain for a frame).
   * Optional for backward compatibility — callers that do not yet thread it
   * fall back to the cookie read inside `useLocale`.
   */
  readonly initialLocale?: Locale;
}

/**
 * Per-screen header strip — spec ID + persona + title + intent.
 *
 * Every route stub in (routes)/ renders this at the top so the surface stays
 * self-describing during the bootstrap phase. The spec ID (O-W-NN) is
 * intentionally visible while we wire real functionality, so reviewers can
 * match each surface against UI_SCREEN_CATALOGUE.md without leaving the page.
 *
 * ZERO-MIX LANGUAGE CANON: exactly ONE language renders per active locale.
 * The headline AND the intent paragraph each pick `en`/`sw` from the screen
 * catalogue's bilingual pair via `pickByLocale`; there is NO always-on Swahili
 * gloss (an EN headline with a permanent SW subtitle IS mixing). The intent
 * paragraph now carries a full `intentSw` parity translation in the catalogue,
 * so under `sw` the Swahili intent renders — never English prose under a
 * Swahili headline, and never an omitted intent under `sw`.
 */
export function ScreenHeader({ slug, initialLocale }: ScreenHeaderProps) {
  const locale = useLocale(initialLocale);
  const screen = getScreenBySlug(slug);
  if (!screen) {
    return (
      <header className="border-b border-border px-8 py-6">
        <h1 className="font-display text-2xl text-destructive">
          {pickByLocale(locale, {
            en: `Unknown screen: ${slug}`,
            sw: `Skrini haijulikani: ${slug}`,
          })}
        </h1>
      </header>
    );
  }
  const title = pickByLocale(locale, { en: screen.title, sw: screen.titleSw });
  return (
    <header className="border-b border-border px-8 py-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">
          {screen.id}
        </span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-muted-foreground">
          {screen.persona}
        </span>
      </div>
      <h1 className="mt-1 font-display text-3xl text-foreground">{title}</h1>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        {pickByLocale(locale, { en: screen.intent, sw: screen.intentSw })}
      </p>
    </header>
  );
}
