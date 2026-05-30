'use client';

import { motion } from 'framer-motion';
import { Home, Mic, MessageSquare, type LucideIcon } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * InteractiveModesSection — three doors into Mr. Mwikila's brain.
 *
 *   Marketing chat — sells (the one on the page right now)
 *   Home chat      — teaches (inside the product)
 *   Voice          — hands-free (truck · pit gate · wash plant)
 *
 * Three-card grid. Each card carries an icon chip, title + subtitle,
 * a short editorial body, and a mock chat snippet (one user line, one
 * AI line) at the bottom.
 */
const ICONS: Record<string, LucideIcon> = {
  marketing: MessageSquare,
  home: Home,
  voice: Mic,
};

export function InteractiveModesSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.interactiveModes;
  return (
    <section
      aria-labelledby="interactive-modes-heading"
      className="relative overflow-hidden bg-surface-sunken py-16 md:py-24"
    >
      {/* Soft gold gradient halo behind the heading band */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, oklch(0.78 0.17 78 / 0.10) 0%, transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-7xl px-5">
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
            id="interactive-modes-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-foreground/70">
            {t.sub}
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-3">
          {t.modes.map((mode, idx) => {
            const Icon = ICONS[mode.id] ?? MessageSquare;
            return (
              <motion.article
                key={mode.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.35, delay: idx * 0.06 }}
                className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-[border-color,box-shadow,transform] duration-base ease-out hover:-translate-y-px hover:border-signal-500/40 hover:shadow-signal-glow-soft"
              >
                <div className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-signal-500/15">
                      <Icon
                        className="h-5 w-5 text-signal-500"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-foreground">
                        {mode.title}
                      </h3>
                      <span className="font-mono text-tiny uppercase tracking-widest text-signal-500">
                        {mode.subtitle}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground/70">
                    {mode.desc}
                  </p>
                </div>

                {/* Mock chat snippet */}
                <div className="mt-auto border-t border-border bg-background/60 p-4">
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <span className="max-w-bubble rounded-2xl rounded-br-sm bg-signal-500/20 px-3 py-2 text-xs leading-relaxed text-foreground">
                        {mode.preview.user}
                      </span>
                    </div>
                    <div className="flex justify-start">
                      <span className="max-w-bubble rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground/75">
                        {mode.preview.ai}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
