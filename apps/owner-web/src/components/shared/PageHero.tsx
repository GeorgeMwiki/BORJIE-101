import type { ReactNode } from 'react';
import { getScreenBySlug } from '@/lib/screens';

interface PageHeroProps {
  readonly slug: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

/**
 * LitFin-rhythm page hero used by every owner-web route.
 *
 * Composition (top to bottom):
 *  1. Eyebrow strip — spec ID + persona pill (lowercase, mono).
 *  2. Display headline (Syne, tight tracking, large).
 *  3. Swahili gloss in italic neutral.
 *  4. Intent body line (max 2xl).
 *  5. Actions strip (right-aligned on desktop, wraps under on mobile).
 *  6. Optional meta strip (chips / counts / KPIs) below the body.
 *
 * Replaces the older minimal `ScreenHeader` for content surfaces that
 * deserve the institutional look. ScreenHeader is kept for back-compat
 * but new pages should use this instead.
 */
export function PageHero({ slug, actions, meta }: PageHeroProps) {
  const screen = getScreenBySlug(slug);
  if (!screen) {
    return (
      <header className="border-b border-border pb-6">
        <h1 className="font-display text-2xl text-destructive">
          Unknown screen: {slug}
        </h1>
      </header>
    );
  }
  return (
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-signal-500">
            <span>{screen.id}</span>
            <span className="text-neutral-700">·</span>
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-neutral-400">
              {screen.persona}
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {screen.title}
          </h1>
          <p className="mt-1 text-sm italic text-neutral-500">
            {screen.titleSw}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            {screen.intent}
          </p>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div className="mt-6">{meta}</div> : null}
    </header>
  );
}
