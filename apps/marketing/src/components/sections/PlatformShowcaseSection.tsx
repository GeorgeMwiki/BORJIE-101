'use client';

import { motion } from 'framer-motion';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * PlatformShowcaseSection — three product-surface mockup tiles
 * (Owner Cockpit · Workforce Mobile · Buyer Marketplace).
 *
 * NO screenshots. Each tile is real DOM — gold-accented mock-frame
 * with a title bar (three traffic-light dots + caption), then a tiny
 * KPI strip / shift log / market listing depending on the tile type.
 * Borjie palette only.
 */

type Tile = {
  readonly title: string;
  readonly subtitle: string;
  readonly desc: string;
  readonly mockType: 'kpi' | 'shift' | 'market';
  readonly kpis?: readonly { readonly label: string; readonly value: string }[];
  readonly rows?: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone: string;
  }[];
  readonly listings?: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone: string;
  }[];
};

export function PlatformShowcaseSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.platformShowcase;
  const tiles = t.tiles as readonly Tile[];

  return (
    <section
      aria-labelledby="platform-showcase-heading"
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
          <span className="font-mono text-meta font-semibold uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="platform-showcase-heading"
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
          {tiles.map((tile, idx) => (
            <motion.article
              key={tile.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.35, delay: idx * 0.08 }}
              className="overflow-hidden rounded-xl border border-border bg-surface p-1 transition-[transform,box-shadow] duration-base ease-out hover:-translate-y-px hover:shadow-signal-glow-soft"
            >
              <div className="overflow-hidden rounded-lg border border-border bg-background/60">
                {/* mock-frame chrome */}
                <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
                  <div className="flex gap-1.5" aria-hidden="true">
                    <div className="h-2 w-2 rounded-full bg-neutral-500/40" />
                    <div className="h-2 w-2 rounded-full bg-neutral-500/40" />
                    <div className="h-2 w-2 rounded-full bg-neutral-500/40" />
                  </div>
                  <span className="ml-1 font-mono text-tiny uppercase tracking-widest text-foreground/60">
                    {tile.title}
                  </span>
                </div>

                {/* per-tile mock content */}
                <div className="p-4">
                  {tile.mockType === 'kpi' && tile.kpis && (
                    <div className="grid grid-cols-3 gap-2">
                      {tile.kpis.map((k) => (
                        <div
                          key={k.label}
                          className="rounded-md border border-border bg-surface px-2 py-2 text-center"
                        >
                          <div className="font-display text-lg font-semibold tabular-nums text-signal-500">
                            {k.value}
                          </div>
                          <div className="mt-0.5 font-mono text-spark uppercase tracking-wider text-foreground/60">
                            {k.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tile.mockType === 'shift' && tile.rows && (
                    <div className="space-y-2">
                      {tile.rows.map((r) => (
                        <div
                          key={r.label}
                          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                        >
                          <span className="truncate text-xs text-foreground/75">
                            {r.label}
                          </span>
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums ${
                              r.tone === 'warn'
                                ? 'text-signal-500'
                                : 'text-success'
                            }`}
                          >
                            {r.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {tile.mockType === 'market' && tile.listings && (
                    <div className="space-y-2">
                      {tile.listings.map((l) => (
                        <div
                          key={l.label}
                          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                        >
                          <span className="flex items-center gap-2 truncate text-xs text-foreground/75">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                              aria-hidden="true"
                            />
                            {l.label}
                          </span>
                          <span className="font-mono text-xs font-semibold tabular-nums text-signal-500">
                            {l.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* tile caption */}
              <div className="px-4 py-3">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {tile.title}
                </h3>
                <div className="font-mono text-tiny uppercase tracking-widest text-signal-500">
                  {tile.subtitle}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/70">
                  {tile.desc}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
