import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  type LucideIcon,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { type Locale } from '@/lib/i18n';

/**
 * AudiencePage — shared LitFin-parity audience template ported to the
 * Borjie navy + gold palette and the Tanzanian-mining audience set.
 *
 * Mirrors the structure of LitFin's `(marketing)/for-banks/page.tsx`:
 *   1. Hero band with kicker pill, big claim, sub-paragraph, dual CTA,
 *      and a trustline strip of three quick proof bullets.
 *   2. "Why this matters" stats triplet (three large numbers).
 *   3. "How it works" three-step ordered list.
 *   4. Problem / Solution duo (LitFin's "WHY CREDIT BUSINESS" pattern),
 *      red numerical dots on the left, gold check-circles on the right.
 *   5. Closing CTA band with sign-up call-to-action.
 *
 * Everything is presentational. The page that mounts this template is
 * an async RSC that resolves locale once and passes typed copy in.
 *
 * Keep this component in lockstep with `for-banks/page.tsx` structure so
 * every audience page reads as a sibling of the same template.
 */

export interface AudienceStat {
  readonly value: string;
  readonly label: string;
  readonly sub: string;
}

export interface AudienceStep {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

export interface AudienceCardItem {
  readonly title: string;
  readonly desc: string;
}

export interface AudiencePageCopy {
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly heroKicker: string;
  readonly heroHeadline: string;
  readonly heroHeadlineAccent: string;
  readonly heroSub: string;
  readonly heroPrimaryCta: string;
  readonly heroSecondaryCta: string;
  readonly trustline: readonly string[];
  readonly statsHeading: string;
  readonly statsSub: string;
  readonly stats: readonly AudienceStat[];
  readonly stepsKicker: string;
  readonly stepsHeading: string;
  readonly steps: readonly AudienceStep[];
  readonly problemKicker: string;
  readonly problemHeading: string;
  readonly problemHeadingAccent: string;
  readonly problemSub: string;
  readonly problemTitle: string;
  readonly problems: readonly AudienceCardItem[];
  readonly solutionTitle: string;
  readonly solutions: readonly AudienceCardItem[];
  readonly ctaHeading: string;
  readonly ctaSub: string;
  readonly ctaPrimary: string;
}

export interface AudiencePageProps {
  readonly locale: Locale;
  readonly copy: AudiencePageCopy;
  readonly kickerIcon: LucideIcon;
}

export function AudiencePage({ copy, kickerIcon: KickerIcon }: AudiencePageProps) {
  return (
    <div className="overflow-x-hidden">
      {/* HERO */}
      <section
        className="relative isolate overflow-hidden"
        aria-labelledby="audience-hero-headline"
      >
        <div className="hero-aurora" aria-hidden="true" />
        <div
          className="absolute inset-0 cinematic-grid opacity-40"
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-20 lg:px-8 lg:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-surface/80 px-3 py-1 font-mono text-meta uppercase tracking-widest text-signal-500 backdrop-blur">
              <KickerIcon
                className="h-3.5 w-3.5 text-signal-500"
                aria-hidden="true"
              />
              <span>{copy.heroKicker}</span>
            </span>

            <h1
              id="audience-hero-headline"
              className="mt-6 font-display text-5xl font-medium leading-[1.02] tracking-tighter text-foreground text-balance md:text-6xl lg:text-7xl"
            >
              {copy.heroHeadline}{' '}
              <span className="italic text-signal-500">
                {copy.heroHeadlineAccent}
              </span>
              .
            </h1>

            <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-neutral-400 sm:text-xl">
              {copy.heroSub}
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/pilot"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-7 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-signal-glow active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {copy.heroPrimaryCta}
                <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-surface/60 px-7 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised"
              >
                {copy.heroSecondaryCta}
              </Link>
            </div>

            <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-neutral-500">
              {copy.trustline.map((line, i) => {
                const dotTone =
                  i === 0
                    ? 'bg-emerald-500'
                    : i === 1
                      ? 'bg-signal-500'
                      : 'bg-amber-400';
                return (
                  <li
                    key={line}
                    className="inline-flex items-center gap-1.5"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${dotTone}`}
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* STATS TRIPLET */}
      <section
        className="px-5 py-16 md:py-24"
        aria-labelledby="audience-stats-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2
              id="audience-stats-heading"
              className="font-display text-4xl font-medium tracking-tight text-foreground text-balance md:text-5xl"
            >
              {copy.statsHeading}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-neutral-400">
              {copy.statsSub}
            </p>
          </div>

          <ul className="mt-12 grid gap-6 md:grid-cols-3">
            {copy.stats.map((s) => (
              <li
                key={s.label}
                className="h-full rounded-lg border border-border bg-surface p-8 transition-colors duration-fast hover:border-signal-500/40"
              >
                <p className="font-display text-5xl font-medium tabular-nums tracking-tight text-foreground">
                  {s.value}
                </p>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {s.label}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  {s.sub}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        id="how-it-works"
        className="border-y border-border bg-surface-sunken px-5 py-16 md:py-24"
        aria-labelledby="audience-steps-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
              {copy.stepsKicker}
            </p>
            <h2
              id="audience-steps-heading"
              className="mt-3 font-display text-4xl font-medium tracking-tight text-foreground text-balance md:text-5xl"
            >
              {copy.stepsHeading}
            </h2>
          </div>

          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {copy.steps.map((step) => (
              <li
                key={step.n}
                className="relative rounded-lg border border-border bg-surface p-8"
              >
                <p className="font-mono text-sm font-semibold tabular-nums text-signal-500">
                  {step.n}
                </p>
                <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* PROBLEM / SOLUTION DUO */}
      <section
        className="bg-surface-sunken py-16 md:py-24"
        aria-labelledby="audience-problem-heading"
      >
        <div className="mx-auto max-w-7xl px-5">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
              {copy.problemKicker}
            </p>
            <h2
              id="audience-problem-heading"
              className="mt-3 font-display text-4xl font-medium tracking-tight text-foreground text-balance md:text-5xl"
            >
              {copy.problemHeading}{' '}
              <span className="text-signal-500">{copy.problemHeadingAccent}</span>
            </h2>
            <p className="mx-auto mt-5 max-w-prose-wide text-lg leading-relaxed text-neutral-400">
              {copy.problemSub}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <article className="flex h-full flex-col rounded-lg border border-border bg-surface p-8">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/15">
                  <TrendingUp
                    className="h-5 w-5 text-destructive"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </span>
                <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                  {copy.problemTitle}
                </h3>
              </div>
              <ul className="space-y-5">
                {copy.problems.map((item, i) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-[11px] font-semibold tabular-nums text-destructive"
                    >
                      {i + 1}
                    </span>
                    <div>
                      <span className="text-sm font-semibold text-foreground">
                        {item.title}
                      </span>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                        {item.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="flex h-full flex-col rounded-lg border border-border bg-surface p-8">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-signal-500/15">
                  <Sparkles
                    className="h-5 w-5 text-signal-500"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </span>
                <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                  {copy.solutionTitle}
                </h3>
              </div>
              <ul className="space-y-5">
                {copy.solutions.map((item) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <CheckCircle2
                      className="mt-0.5 h-5 w-5 shrink-0 text-signal-500"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <div>
                      <span className="text-sm font-semibold text-foreground">
                        {item.title}
                      </span>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                        {item.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* CTA FOOTER */}
      <section
        className="border-t border-border px-5 py-16 md:py-24"
        aria-labelledby="audience-cta-heading"
      >
        <div className="mx-auto max-w-4xl text-center">
          <h2
            id="audience-cta-heading"
            className="font-display text-4xl font-medium tracking-tight text-foreground text-balance md:text-5xl"
          >
            {copy.ctaHeading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-neutral-400">
            {copy.ctaSub}
          </p>
          <div className="mt-10 flex justify-center">
            <Link
              href="/pilot"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-7 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-signal-glow active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {copy.ctaPrimary}
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
