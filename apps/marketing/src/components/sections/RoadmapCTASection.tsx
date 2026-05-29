'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * RoadmapCTASection — full-bleed closing band. Aurora-styled gold
 * background, headline + subhead, four roadmap pills (one per quarter
 * across 2026), and a dual CTA at the bottom.
 *
 * Pills carry a tone — 'active' (current quarter, gold-filled), 'next'
 * (gold-outline), 'later' (neutral border). Microcopy under the dual
 * CTA defuses cost objections.
 */
type Pill = {
  readonly label: string;
  readonly title: string;
  readonly tone: 'active' | 'next' | 'later';
};

const PILL_TONE_CLASSES: Record<Pill['tone'], string> = {
  active:
    'bg-signal-500/20 border-signal-500 text-foreground shadow-signal-glow',
  next: 'border-signal-500/60 bg-signal-500/5 text-foreground',
  later: 'border-border bg-surface text-neutral-300',
};

export function RoadmapCTASection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.roadmap;
  const pills = t.pills as readonly Pill[];

  return (
    <section
      aria-labelledby="roadmap-cta-heading"
      className="relative overflow-hidden bg-background py-20 md:py-28"
    >
      {/* Aurora behind the band */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 40%, oklch(0.78 0.17 78 / 0.16) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 30% 70%, oklch(0.58 0.12 65 / 0.10) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      {/* Hairline grid overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(oklch(0.24 0.02 260 / 0.5) 1px, transparent 1px), linear-gradient(90deg, oklch(0.24 0.02 260 / 0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 80%)',
        }}
      />

      <div className="relative mx-auto max-w-5xl px-5 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.4 }}
        >
          <span className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="roadmap-cta-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl lg:text-6xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-neutral-400">
            {t.sub}
          </p>
        </motion.div>

        {/* Roadmap pills */}
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pills.map((pill, i) => (
            <motion.div
              key={pill.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.35, delay: i * 0.08 }}
              className={`relative rounded-lg border p-5 text-left transition-colors ${PILL_TONE_CLASSES[pill.tone]}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-tiny uppercase tracking-widest text-signal-500">
                  {pill.label}
                </span>
                {pill.tone === 'active' && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-success"
                  />
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold leading-snug tracking-tight">
                {pill.title}
              </h3>
            </motion.div>
          ))}
        </div>

        {/* Dual CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-12"
        >
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/pilot"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-8 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-signal-glow focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background active:scale-[0.98]"
            >
              {t.ctaPrimary}
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/pilot#contact"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-surface px-8 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background"
            >
              <MessageCircle className="h-4 w-4" />
              {t.ctaSecondary}
            </Link>
          </div>
          <p className="mt-5 font-mono text-meta uppercase tracking-widest text-neutral-500">
            {t.microcopy}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
