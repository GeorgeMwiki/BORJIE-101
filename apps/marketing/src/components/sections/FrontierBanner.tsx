'use client';

import { motion } from 'framer-motion';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * FrontierBanner — small kicker section between hero/capabilities and
 * the rest of the marketing surface. Mirrors LitFin's "frontier banner"
 * editorial moment: a single tagline + gold accent + one-line subhead.
 *
 * Framer-motion fade-in on the centred text block; collapses to instant
 * when prefers-reduced-motion is set (motion handles the gate
 * internally via `useReducedMotion` defaults on `viewport`/`once`).
 */
export function FrontierBanner({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).home.frontierBanner;
  return (
    <section
      aria-labelledby="frontier-banner-headline"
      className="relative border-y border-border bg-signal-500/5 py-10"
    >
      <div className="mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <span className="font-mono text-meta font-semibold uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <p
            id="frontier-banner-headline"
            className="mt-2 font-display text-xl tracking-tight text-foreground sm:text-2xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </p>
          <p className="mx-auto mt-2 max-w-prose-wide text-sm text-foreground/70">
            {t.sub}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
