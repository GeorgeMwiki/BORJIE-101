import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /blog , LitFin-parity blog index.
 *
 * No MDX posts ship in this wave; the page renders a focused empty
 * state with a hero (kicker / heading / sub) and a single tile that
 * points the reader to docs and to the sign-up page. When editorial
 * adds MDX, the empty state hides and the grid renders.
 *
 * The template DNA mirrors LitFin's blog landing: centered hero,
 * 3-up card grid placeholder, subscribe band, final CTA, footer.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).blog;
  return {
    title: `${t.kicker} , Borjie`,
    description: t.sub,
  };
}

export default async function BlogIndexPage() {
  const locale = await getLocale();
  const t = getMessages(locale).blog;

  return (
    <>
      
      <main id="main-content">
        <section
          className="relative overflow-hidden"
          aria-labelledby="blog-heading"
        >
          <div className="hero-aurora" aria-hidden="true" />
          <div
            className="absolute inset-0 cinematic-grid opacity-30"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-3xl px-6 py-20 text-center lg:py-28">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.kicker}
            </p>
            <h1
              id="blog-heading"
              className="mt-5 font-display text-5xl font-medium tracking-tight text-balance sm:text-6xl"
            >
              {t.heading}
            </h1>
            <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-foreground/70 sm:text-xl">
              {t.sub}
            </p>
          </div>
        </section>

        {/* EMPTY STATE , LitFin pageframe/EmptyState */}
        <section
          className="mx-auto max-w-3xl px-6 pb-24 lg:px-8"
          aria-labelledby="blog-empty-heading"
        >
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface text-signal-500">
              <BookOpen aria-hidden="true" className="h-7 w-7" />
            </div>
            <h2
              id="blog-empty-heading"
              className="font-display text-3xl font-medium tracking-tight text-balance"
            >
              {t.emptyHeading}
            </h2>
            <p className="mx-auto mt-4 max-w-prose-wider text-base leading-relaxed text-foreground/70">
              {t.emptyBody}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/docs"
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                {t.emptyCtaPrimary}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-6 text-sm font-semibold text-foreground transition-colors hover:bg-surface-raised"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t.emptyCtaSecondary}
              </Link>
            </div>
          </div>
        </section>

        {/* SUBSCRIBE , LitFin S15 variant */}
        <section
          className="border-t border-border bg-surface/40 px-5 py-16 md:py-20"
          aria-labelledby="blog-subscribe-heading"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="blog-subscribe-heading"
              className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl"
            >
              {t.subscribeHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-foreground/70">
              {t.subscribeSub}
            </p>
            <form
              action="/api/subscribe"
              method="post"
              className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
            >
              <label htmlFor="blog-subscribe-email" className="sr-only">
                {t.subscribePlaceholder}
              </label>
              <input
                id="blog-subscribe-email"
                type="email"
                name="email"
                required
                placeholder={t.subscribePlaceholder}
                className="h-11 flex-1 rounded-md border border-border bg-card px-4 text-sm text-foreground placeholder:text-foreground/60 focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                {t.subscribeCta}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        </section>
      </main>
      
    </>
  );
}
