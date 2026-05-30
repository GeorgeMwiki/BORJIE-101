'use client';

import { motion } from 'framer-motion';
import { Languages, Monitor, Smartphone } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * UniversalAccessSection — bilingual sw/en framing + multi-device
 * positioning. Three-card grid: Swahili-first by default, phone for
 * the pit / tablet for the office, desktop for the regulator.
 *
 * Cards use the surface card background with a gold icon-chip header
 * and editorial body copy. Motion is light (fade-up on view with
 * stagger).
 */
const ICONS = [Languages, Smartphone, Monitor] as const;

export function UniversalAccessSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.universalAccess;
  return (
    <section
      aria-labelledby="universal-access-heading"
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
          <span className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="universal-access-heading"
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
          {t.cards.map((card, i) => {
            const Icon = ICONS[i] ?? Languages;
            return (
              <motion.article
                key={card.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.35, delay: i * 0.06 }}
                className="flex h-full flex-col rounded-lg border border-border bg-surface p-7"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-signal-500/10">
                    <Icon
                      className="h-5 w-5 text-signal-500"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    {card.title}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-foreground/70">
                  {card.body}
                </p>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
