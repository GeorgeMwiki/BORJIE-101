import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).pageMeta.buyers;
  return buildSegmentMetadata({
    path: '/buyers',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

/**
 * /buyers — landing page for the buyer / off-taker audience.
 *
 * Mirrors the homepage section rhythm but tuned for buyers:
 *   - Hero with declarative one-liner + dual CTA
 *   - TrustStrip (shared component) anchors the regulator wall
 *   - Four-up value-prop grid (provenance, KYB, assay, biometric)
 *   - Region grid (currently sourced from) in mono-caption tiles
 *   - Built-for-buyers band (pre-launch): credential-led cards + pilot CTA
 *   - Pricing card (single fee structure, generous whitespace)
 *   - Final CTA band — waitlist + sourcing team
 *
 * All visible strings flow through i18n (en / sw) so the bilingual
 * locale toggle in <Nav> stays canonical.
 */
export default async function BuyersPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyersPage;
  const valueProps = t.valueProps.shortCards;
  const regions = t.regions;
  const builtForCards = t.builtFor.cards;

  return (
    <>
      
      <div className="min-h-screen bg-background text-foreground">
        {/* Hero */}
        <section
          className="relative overflow-hidden"
          aria-labelledby="buyers-hero-heading"
        >
          <div className="hero-aurora" aria-hidden="true" />
          <div
            className="absolute inset-0 cinematic-grid opacity-30"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-20 lg:px-8 lg:pb-20 lg:pt-28">
            <div className="mx-auto max-w-3xl text-center">
              <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
                {t.kicker}
              </p>
              <h1
                id="buyers-hero-heading"
                className="mt-5 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
              >
                {t.heading}
              </h1>
              <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-foreground/70 sm:text-xl">
                {t.sub}
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/buyers/signup"
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.98]"
                >
                  {t.ctaSignUpBuy}
                  <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/buyers/sign-in"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface/60 px-6 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised"
                >
                  {t.ctaAlreadyBuyer}
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex h-12 items-center justify-center px-3 text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground"
                >
                  {t.ctaPricingFees}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Value propositions — four-up grid */}
        <section
          className="relative mx-auto max-w-7xl px-6 pb-24 pt-20 lg:px-8"
          aria-labelledby="buyers-valueprops-heading"
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.valueProps.kicker}
            </p>
            <h2
              id="buyers-valueprops-heading"
              className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              {t.valueProps.heading}
            </h2>
            <p className="mx-auto mt-5 max-w-prose-wider text-lg leading-relaxed text-foreground/70">
              {t.valueProps.sub}
            </p>
          </div>

          <ul className="mt-14 grid gap-px rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {valueProps.map((card, i) => (
              <li
                key={card.title}
                className="group relative flex flex-col gap-4 bg-surface p-7 transition-colors duration-fast hover:bg-surface-raised"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-signal-500/25 bg-signal-500/5 text-signal-500 transition-all duration-base ease-out group-hover:border-signal-500/50 group-hover:shadow-signal-glow">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold tracking-tight">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/70">
                    {card.body}
                  </p>
                </div>
                <span className="absolute right-5 top-5 font-mono text-caption-lg uppercase tracking-widest text-foreground/60">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Built for verified buyers — pre-launch, credential-led */}
        <section
          className="relative mx-auto max-w-7xl px-6 pb-24 lg:px-8"
          aria-labelledby="buyers-builtfor-heading"
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.builtFor.kicker}
            </p>
            <h2
              id="buyers-builtfor-heading"
              className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              {t.builtFor.heading}
            </h2>
            <p className="mx-auto mt-5 max-w-prose-wider text-lg leading-relaxed text-foreground/70">
              {t.builtFor.sub}
            </p>
          </div>

          <ul className="mt-14 grid gap-5 md:grid-cols-3">
            {builtForCards.map((c) => (
              <li
                key={c.title}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-signal-500/25 bg-signal-500/5 text-signal-500">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <h3 className="font-display text-xl font-semibold tracking-tight">
                  {c.title}
                </h3>
                <p className="text-sm leading-relaxed text-foreground/70">{c.body}</p>
              </li>
            ))}
          </ul>

          <div className="mt-12 flex justify-center">
            <Link
              href="/pilot"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.98]"
            >
              {t.builtFor.cta}
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>

        {/* Region grid */}
        <section
          className="relative mx-auto max-w-7xl px-6 pb-24 lg:px-8"
          aria-labelledby="buyers-regions-heading"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="buyers-regions-heading"
              className="font-display text-3xl font-semibold tracking-tight"
            >
              {t.regionsHeading}
            </h2>
          </div>
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {regions.map((r) => (
              <li
                key={r}
                className="rounded-xl border border-border bg-surface px-4 py-3 text-center font-mono text-caption-lg uppercase tracking-widest text-foreground/70 transition-colors duration-fast hover:border-signal-500/30 hover:text-foreground"
              >
                {r}
              </li>
            ))}
          </ul>
        </section>

        {/* Pricing card */}
        <section
          className="relative mx-auto max-w-7xl px-6 pb-24 lg:px-8"
          aria-labelledby="buyers-pricing-heading"
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.pricing.kicker}
            </p>
            <h2
              id="buyers-pricing-heading"
              className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              {t.pricing.heading}
            </h2>
            <p className="mx-auto mt-5 max-w-prose-wider text-lg leading-relaxed text-foreground/70">
              {t.pricing.sub}
            </p>
          </div>

          <article className="mx-auto mt-14 flex max-w-2xl flex-col gap-5 rounded-2xl border border-signal-500/40 bg-surface p-8 ring-1 ring-signal-500/30 shadow-signal-glow-card sm:p-10">
            <header>
              <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
                {t.marketplaceFeeKicker}
              </p>
              <p className="mt-3 font-display text-6xl font-semibold leading-none tracking-tight tabular-nums">
                2.5%
              </p>
              <p className="mt-3 text-sm text-foreground/70">{t.marketplaceFeeBody}</p>
            </header>

            <ul className="space-y-2 border-t border-border pt-5">
              {t.pricing.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <p className="text-xs leading-relaxed text-foreground/60">{t.pricing.footnote}</p>
          </article>
        </section>

        {/* Final CTA — waitlist + sourcing team */}
        <section
          className="relative overflow-hidden"
          aria-labelledby="buyers-final-cta-heading"
        >
          <div className="hero-aurora" aria-hidden="true" />
          <div className="relative mx-auto max-w-5xl px-6 py-24 text-center lg:px-8">
            <h2
              id="buyers-final-cta-heading"
              className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              {t.downloadCta.heading}
            </h2>
            <p className="mx-auto mt-6 max-w-prose-wider text-lg leading-relaxed text-foreground/70">
              {t.downloadCta.sub}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/buyers/signup"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-7 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.98]"
              >
                {t.downloadCta.primary}
                <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/about"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface/60 px-7 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised"
              >
                {t.downloadCta.secondary}
              </Link>
            </div>
          </div>
        </section>
      </div>
      
    </>
  );
}
