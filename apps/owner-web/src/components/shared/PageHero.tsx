'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@borjie/design-system';
import { getScreenBySlug } from '@/lib/screens';
import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import type { Locale } from '@/lib/locale-shared';

interface PageHeroProps {
  readonly slug: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
  /**
   * Server-resolved active locale. Seeds the first client render so SSR and
   * hydration agree (zero-mix canon: no EN-under-SW split-brain for a frame).
   * Optional for backward compatibility — the many existing callers that do
   * not yet thread it fall back to the cookie read inside `useLocale`.
   */
  readonly initialLocale?: Locale;
}

/**
 * Institutional-rhythm page hero used by every owner-web route (CONVERGED onto
 * the DS `PageHeader`).
 *
 * The headline + intent + actions block is delegated to `PageHeader` from
 * `@borjie/design-system` — the DS primitive owns the canonical
 * title / description / right-aligned-actions layout and its tokens. This
 * wrapper keeps owner-web's institutional chrome that DS does NOT model:
 *  1. Eyebrow strip — spec ID + persona pill (lowercase, mono).
 *  2. DS PageHeader: display headline (title) + intent body (description)
 *     + actions strip.
 *  3. Optional meta strip (chips / counts / KPIs) below.
 *
 * ZERO-MIX LANGUAGE CANON: exactly ONE language renders per active locale.
 * The headline AND the intent body each pick `en`/`sw` from the screen
 * catalogue's bilingual pair via `pickByLocale`; there is NO always-on Swahili
 * gloss (an EN headline with a permanent SW subtitle IS mixing). The intent
 * paragraph now carries a full `intentSw` parity translation in the catalogue,
 * so under `sw` the Swahili intent renders — never English prose under a
 * Swahili headline, and never an omitted intent under `sw`.
 *
 * Public API ({ slug, actions?, meta? }) is UNCHANGED for existing callers;
 * `initialLocale?` is additive and optional — do not break the 20+ route pages
 * that import this verbatim.
 */
export function PageHero({ slug, actions, meta, initialLocale }: PageHeroProps) {
  const locale = useLocale(initialLocale);
  const screen = getScreenBySlug(slug);
  if (!screen) {
    return (
      <header className="border-b border-border pb-6">
        <PageHeader
          title={pickByLocale(locale, {
            en: `Unknown screen: ${slug}`,
            sw: `Skrini haijulikani: ${slug}`,
          })}
          className="mb-0"
        />
      </header>
    );
  }
  const title = pickByLocale(locale, { en: screen.title, sw: screen.titleSw });
  return (
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
        <span>{screen.id}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-muted-foreground">
          {screen.persona}
        </span>
      </div>
      <PageHeader
        title={title}
        // Intent body renders in the ACTIVE locale via the catalogue's bilingual
        // pair — full parity, never English prose under a Swahili headline.
        description={pickByLocale(locale, {
          en: screen.intent,
          sw: screen.intentSw,
        })}
        actions={actions}
        className="mt-3 mb-0"
      />
      {meta ? <div className="mt-6">{meta}</div> : null}
    </header>
  );
}
