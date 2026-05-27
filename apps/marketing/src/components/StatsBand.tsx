import { getMessages, type Locale } from '@/lib/i18n';

/**
 * StatsBand — the "by the numbers" band LitFin and the broader 2026
 * fintech SaaS pattern uses to convert hero promise into measurable
 * proof. Big mono numerals, faint editorial labels, a single subtle
 * delta chip per stat that mirrors the daily-brief stat tile.
 *
 * Stats are sourced from pilot telemetry (i18n `stats.items`). Every
 * delta is explicitly labelled "indicative" when it doesn't reflect a
 * closed deal — per the truth-first hard rule in CLAUDE.md.
 *
 * Sits between AskShowcase and AutonomyDialDemo in the homepage flow:
 * after the visitor has seen what the brain DOES (brief + Ask), the
 * stats band turns capability into outcome.
 */
export function StatsBand({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).stats;

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="stats-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="stats-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-prose-wider text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {t.items.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-3 bg-surface p-7">
            <dt className="font-mono text-caption uppercase tracking-widest text-neutral-400">
              {stat.label}
            </dt>
            <dd className="flex items-baseline justify-between gap-3">
              <span className="font-display text-5xl font-medium leading-none tracking-tight text-foreground tabular-nums">
                {stat.value}
              </span>
              <span className="font-mono text-caption-lg uppercase tracking-widest text-signal-500">
                {stat.delta}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 text-center text-sm text-neutral-500">{t.footnote}</p>
    </section>
  );
}
