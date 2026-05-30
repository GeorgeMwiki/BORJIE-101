'use client';

import { motion } from 'framer-motion';
import {
  Building2,
  Coins,
  Gem,
  Landmark,
  Network,
  ScanLine,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { StaggerReveal } from '@/components/animations/StaggerReveal';

/**
 * EcosystemSection — Tanzanian regulator + market + money-rails grid.
 *
 * Three category groups (Regulators · Markets & labs · Money rails)
 * laid out as a single grid card per entity. Each card shows an icon
 * (locked to lucide-react · stroke-1.75), a name, and a one-line role
 * description. Cards use the surface background + gold-tinted icon
 * chip on the navy-slate foundation.
 *
 * StaggerReveal collapses to instant under prefers-reduced-motion.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  'Mining Commission': Landmark,
  NEMC: ShieldCheck,
  'Bank of Tanzania': Building2,
  TRA: TrendingUp,
  BRELA: ScanLine,
  GST: Network,
  LBMA: Coins,
  'ICA Brussels': Gem,
  'M-Pesa': Smartphone,
  'Tigo Pesa': Smartphone,
  'Airtel Money': Wallet,
};

export function EcosystemSection({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).home.ecosystem;
  return (
    <section
      aria-labelledby="ecosystem-heading"
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
            id="ecosystem-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-foreground/70">
            {t.sub}
          </p>
        </motion.div>

        <div className="space-y-10">
          {t.categories.map((category) => (
            <div key={category.title}>
              <h3 className="mb-4 px-1 font-mono text-meta uppercase tracking-widest text-signal-500">
                {category.title}
              </h3>
              <StaggerReveal
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                stagger={50}
              >
                {category.items.map((entry) => {
                  const Icon = ICON_MAP[entry.name] ?? Landmark;
                  return (
                    <div
                      key={entry.name}
                      className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-[border-color,box-shadow,transform] duration-base ease-out hover:-translate-y-px hover:border-signal-500/40 hover:shadow-signal-glow-soft"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-signal-500/10">
                        <Icon
                          className="h-5 w-5 text-signal-500"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                          {entry.name}
                        </div>
                        <div className="mt-0.5 text-xs leading-relaxed text-foreground/70">
                          {entry.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </StaggerReveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
