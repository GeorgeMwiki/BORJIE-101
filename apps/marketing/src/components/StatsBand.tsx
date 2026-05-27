import { getMessages, type Locale } from '@/lib/i18n';
import { CountUp } from '@/components/animations/CountUp';

/**
 * StatsBand — four big numerals that count up from 0 to their target
 * value when the band enters the viewport. Tabular-nums mono digits keep
 * the columns visually stable while the count animates.
 *
 * Each numeral is split into prefix + numeric target + suffix so the
 * count-up tween animates only the number portion while the surrounding
 * label text (currency code, unit suffix) stays static.
 */

interface AnimatedStat {
  readonly key: string;
  readonly label: string;
  readonly prefix: string;
  readonly target: number;
  readonly suffix: string;
  readonly decimals: number;
  readonly delta: string;
}

const STATS_BY_INDEX: readonly Omit<AnimatedStat, 'label' | 'delta'>[] = [
  { key: 'sites', prefix: '', target: 47, suffix: '', decimals: 0 },
  { key: 'briefs', prefix: '', target: 1284, suffix: '', decimals: 0 },
  { key: 'chain', prefix: '', target: 184, suffix: 'k', decimals: 0 },
  { key: 'hedged', prefix: 'TZS ', target: 4.2, suffix: 'B', decimals: 1 },
];

export function StatsBand({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).stats;
  const stats: readonly AnimatedStat[] = t.items.map((item, i) => {
    const base = STATS_BY_INDEX[i] ?? STATS_BY_INDEX[0];
    return {
      ...base!,
      label: item.label,
      delta: item.delta,
    };
  });

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
        {stats.map((stat) => (
          <div key={stat.key} className="flex flex-col gap-3 bg-surface p-7">
            <dt className="font-mono text-caption uppercase tracking-widest text-neutral-400">
              {stat.label}
            </dt>
            <dd className="flex items-baseline justify-between gap-3">
              <CountUp
                target={stat.target}
                prefix={stat.prefix}
                suffix={stat.suffix}
                decimals={stat.decimals}
                className="font-display text-5xl font-medium leading-none tracking-tight text-foreground"
              />
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
