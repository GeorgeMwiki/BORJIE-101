import type { ReactNode } from 'react';

interface PageHeroProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

/**
 * LitFin-rhythm page hero for admin-web.
 *
 * Composition:
 *  - Mono uppercase eyebrow (small caps, signal-coloured)
 *  - Display headline (Syne, tight tracking)
 *  - Sub-paragraph (max-w-2xl)
 *  - Right-side actions slot (wraps on mobile)
 *  - Optional meta slot below the body (KPIs / chips / breadcrumbs)
 *
 * Used by every authenticated admin page. Replaces the older
 * `PageShell` migrated wrapper which double-wrapped the AdminShell
 * layout and produced a confusing double-sidebar render.
 */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
}: PageHeroProps) {
  return (
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-500">
            {eyebrow}
          </p>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div className="mt-6">{meta}</div> : null}
    </header>
  );
}
