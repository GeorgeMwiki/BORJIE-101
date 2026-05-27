import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * FinalCta — the full-bleed closing band that sits between the
 * testimonial wall and the footer. Mirrors LitFin's "ready when you
 * are" closing pattern: kicker, declarative two-line headline, calm
 * sub-paragraph, dual CTA (primary + secondary), and microcopy below
 * the button that defuses the "is this going to cost me?" question.
 *
 * No mock data. No metrics rendered here — the proof points already
 * landed in StatsBand. This band is purely a re-offer.
 */
export function FinalCta({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).finalCta;

  return (
    <section
      className="relative overflow-hidden"
      aria-labelledby="final-cta-heading"
    >
      <div className="hero-aurora" aria-hidden="true" />
      <div className="absolute inset-0 cinematic-grid opacity-30" aria-hidden="true" />

      <div className="relative mx-auto max-w-5xl px-6 py-28 text-center lg:px-8 lg:py-32">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="final-cta-heading"
          className="mx-auto mt-5 max-w-4xl font-display text-4xl font-medium leading-tight tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-6 max-w-prose-wider text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/pilot"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-7 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.98]"
          >
            {t.ctaPrimary}
            <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/about"
            className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface/60 px-7 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised"
          >
            {t.ctaSecondary}
          </Link>
        </div>

        <p className="mt-6 font-mono text-caption-lg uppercase tracking-widest text-neutral-500">
          {t.microcopy}
        </p>
      </div>
    </section>
  );
}
