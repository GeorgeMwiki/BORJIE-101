'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Sparkles, TrendingUp } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * ProblemSolution — LitFin's "WHY CREDIT BUSINESS" pattern, ported to
 * Borjie's mining problem statement.
 *
 * Two-card grid:
 *   LEFT  — PROBLEM (danger-red icon, "Mining at the margin")
 *   RIGHT — SOLUTION (gold/primary icon, "Borjie does the work")
 *
 * Each card lists four numbered items. The left card uses a danger
 * numerical badge; the right uses gold check-circles. Cards are
 * surface cards on the navy-slate background — no new colour tokens.
 */
export function ProblemSolution({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).home.problemSolution;
  return (
    <section
      aria-labelledby="problem-solution-heading"
      className="bg-surface-sunken py-16 md:py-24"
    >
      <div className="mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.4 }}
          className="mx-auto mb-14 max-w-3xl text-center"
        >
          <span className="font-mono text-meta font-semibold uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="problem-solution-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-foreground/70">
            {t.subOne}
          </p>
          <p className="mx-auto mt-3 max-w-prose-wide text-lg font-medium text-foreground">
            {t.subTwo}
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* PROBLEM */}
          <article
            aria-labelledby="problem-card-title"
            className="flex h-full flex-col rounded-lg border border-border bg-surface p-8"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/15">
                <TrendingUp
                  className="h-5 w-5 text-destructive"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </div>
              <h3
                id="problem-card-title"
                className="text-xl font-semibold tracking-tight text-foreground"
              >
                {t.problem.title}
              </h3>
            </div>
            <ul className="space-y-5">
              {t.problem.items.map((item, i) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-badge font-semibold text-destructive tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-foreground">
                      {item.title}
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/70">
                      {item.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          {/* SOLUTION */}
          <article
            aria-labelledby="solution-card-title"
            className="flex h-full flex-col rounded-lg border border-border bg-surface p-8"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-signal-500/15">
                <Sparkles
                  className="h-5 w-5 text-signal-500"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </div>
              <h3
                id="solution-card-title"
                className="text-xl font-semibold tracking-tight text-foreground"
              >
                {t.solution.title}
              </h3>
            </div>
            <ul className="space-y-5">
              {t.solution.items.map((item) => (
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
                    <p className="mt-1 text-sm leading-relaxed text-foreground/70">
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
  );
}
