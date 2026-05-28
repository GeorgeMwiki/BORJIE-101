/**
 * LegalShell , shared shell for every `/legal/*` page.
 *
 * Per `Docs/DESIGN/LITFIN_MARKETING_SECONDARY_SPEC.md` section 7. The
 * shell renders the page hero (kicker, title, last-updated mono small)
 * plus a `max-w-prose` two-column body on lg+: left rail with an
 * anchored section nav, right column with prose body.
 *
 * Sections render as `<section id={id}>` so the anchor nav links
 * resolve. Per-page content passes in via `sections`.
 */

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import type { Locale } from '@/lib/i18n';

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

export interface LegalShellProps {
  readonly locale: Locale;
  readonly kicker: string;
  readonly heading: string;
  readonly lastUpdated: string;
  readonly intro?: string;
  readonly sections: ReadonlyArray<LegalSection>;
  readonly children?: ReactNode;
}

export function LegalShell({
  locale,
  kicker,
  heading,
  lastUpdated,
  intro,
  sections,
  children,
}: LegalShellProps): ReactElement {
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        {/* Hero */}
        <section className="border-b border-border/40 px-6 py-20 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {kicker}
            </p>
            <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              {heading}
            </h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-widest text-neutral-500">
              {lastUpdated}
            </p>
            {intro ? (
              <p className="mx-auto mt-6 max-w-prose-wider text-base leading-relaxed text-neutral-400">
                {intro}
              </p>
            ) : null}
          </div>
        </section>

        {/* Body : 2-col on lg+ : anchor nav | prose */}
        <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_1fr]">
            <aside
              className="hidden lg:sticky lg:top-24 lg:block lg:h-fit"
              aria-label={
                locale === 'sw' ? 'Urambazaji wa kisheria' : 'Legal navigation'
              }
            >
              <ol className="space-y-2 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`#${s.id}`}
                      className="block text-neutral-400 transition-colors hover:text-foreground"
                    >
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ol>
            </aside>
            <div className="prose-mining max-w-prose space-y-10 text-base leading-relaxed text-neutral-300">
              {sections.map((s) => (
                <section key={s.id} id={s.id}>
                  <h2 className="font-display text-2xl font-medium text-foreground">
                    {s.title}
                  </h2>
                  <div className="mt-3 text-sm leading-relaxed text-neutral-400">
                    {s.body}
                  </div>
                </section>
              ))}
              {children}
            </div>
          </div>
        </section>
      </main>
      <Footer locale={locale} />
    </>
  );
}
