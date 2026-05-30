'use client';

import { motion } from 'framer-motion';
import { Quote } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { CountUp } from '@/components/animations/CountUp';

/**
 * InsightsAndScaleSection — two-column closing-cadence section.
 *
 *   LEFT  — "By the numbers" with four CountUp stats
 *   RIGHT — "Pilot voices" with three quote cards
 *
 * Mirrors LitFin's InsightsAndScaleSection editorial split: numerical
 * evidence on one side, human evidence on the other. Both fade up on
 * view, respecting prefers-reduced-motion via the underlying CountUp
 * + framer-motion components.
 */
type StatItem = {
  readonly value: number;
  readonly suffix?: string;
  readonly decimals?: number;
  readonly label: string;
};

export function InsightsAndScaleSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.insights;
  const stats = t.stats as readonly StatItem[];

  return (
    <section
      aria-labelledby="insights-heading"
      className="bg-background py-16 md:py-24"
    >
      <div className="mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.4 }}
          className="mx-auto mb-14 max-w-3xl text-center"
        >
          <span className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="insights-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-foreground/70">
            {t.sub}
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* LEFT — by the numbers */}
          <div className="rounded-lg border border-border bg-surface p-7">
            <h3 className="font-mono text-meta uppercase tracking-widest text-signal-500">
              {t.statsHeading}
            </h3>
            <div className="mt-5 grid grid-cols-2 gap-5">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="rounded-md border border-border bg-background/40 p-4"
                >
                  <div className="font-display text-3xl font-semibold tabular-nums text-signal-500 md:text-4xl">
                    <CountUp
                      target={stat.value}
                      suffix={stat.suffix ?? ''}
                      decimals={stat.decimals ?? 0}
                    />
                  </div>
                  <div className="mt-1.5 text-xs leading-relaxed text-foreground/70">
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* RIGHT — pilot voices */}
          <div>
            <h3 className="mb-4 px-1 font-mono text-meta uppercase tracking-widest text-signal-500">
              {t.quotesHeading}
            </h3>
            <div className="space-y-4">
              {t.quotes.map((q, i) => (
                <motion.figure
                  key={q.name}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="rounded-lg border border-border bg-surface p-5"
                >
                  <Quote
                    className="h-4 w-4 text-signal-500/70"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  <blockquote className="mt-3 text-sm leading-relaxed text-foreground/75">
                    {q.body}
                  </blockquote>
                  <figcaption className="mt-3 flex items-baseline gap-2 text-xs">
                    <span className="font-semibold text-foreground">
                      {q.name}
                    </span>
                    <span className="font-mono text-foreground/60">
                      · {q.role}
                    </span>
                  </figcaption>
                </motion.figure>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
