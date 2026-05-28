'use client';

import { motion } from 'framer-motion';
import {
  CalendarClock,
  Coins,
  FileSignature,
  Lock,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { TiltCard } from '@/components/animations/TiltCard';

/**
 * BentoGrid — asymmetric feature grid mirroring the LitFin bento
 * pattern. Five tiles:
 *
 *   1 audit chain        — col-span-2 row-span-2 hero tile
 *   2 47-day radar       — standard
 *   3 LBMA window hedge  — standard
 *   4 Mining Commission royalty — standard
 *   5 M-Pesa vendor wallet — wide
 *
 * Each tile uses Borjie's signal-glow card pattern, gold icon-chip
 * header, and a small visual flourish underneath (mini progress bar,
 * status pill, or hash-chain row) so the grid never reads as a wall
 * of identical cards.
 */
const ICONS: Record<string, LucideIcon> = {
  audit: Lock,
  licence: CalendarClock,
  hedge: Coins,
  royalty: FileSignature,
  wallet: Wallet,
};

const SPANS: Record<string, string> = {
  audit: 'md:col-span-2 md:row-span-2',
  licence: '',
  hedge: '',
  royalty: '',
  wallet: 'md:col-span-2',
};

export function BentoGrid({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).home.bento;
  return (
    <section
      aria-labelledby="bento-heading"
      className="relative overflow-hidden bg-surface-sunken py-16 md:py-24"
    >
      {/* gold orb top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, oklch(0.78 0.17 78 / 0.12) 0%, transparent 70%)',
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
          <span className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="bento-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-neutral-400">
            {t.sub}
          </p>
        </motion.div>

        <div className="grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-4 md:grid-cols-3">
          {t.tiles.map((tile, idx) => {
            const Icon = ICONS[tile.id] ?? ShieldCheck;
            const span = SPANS[tile.id] ?? '';
            const isHero = tile.id === 'audit';
            return (
              <motion.div
                key={tile.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.35, delay: idx * 0.06 }}
                className={span}
              >
                <TiltCard maxTilt={4} className="h-full">
                  <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface p-6 transition-[border-color,box-shadow] duration-base ease-out hover:border-signal-500/40 hover:shadow-signal-glow-card">
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-signal-500/15">
                        <Icon
                          className="h-6 w-6 text-signal-500"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="rounded-full bg-signal-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal-500">
                        {tile.badge}
                      </span>
                    </div>
                    <h3
                      className={`mb-2 font-display font-semibold tracking-tight text-foreground transition-colors group-hover:text-signal-500 ${
                        isHero ? 'text-2xl' : 'text-lg'
                      }`}
                    >
                      {tile.title}
                    </h3>
                    <p
                      className={`flex-1 leading-relaxed text-neutral-400 ${
                        isHero ? 'text-base' : 'text-sm'
                      }`}
                    >
                      {tile.desc}
                    </p>

                    {/* per-tile visual flourish */}
                    <div className="mt-5">
                      <BentoFlourish tileId={tile.id} />
                    </div>
                  </article>
                </TiltCard>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * BentoFlourish — tiny supporting visual per tile. Pure DOM. Keeps the
 * cards from feeling like a wall of paragraphs.
 */
function BentoFlourish({ tileId }: { readonly tileId: string }) {
  switch (tileId) {
    case 'audit':
      return (
        <div className="rounded-md border border-border bg-background/50 p-3">
          {[
            { seq: 18429, hash: '2e…440' },
            { seq: 18430, hash: '7c…918' },
            { seq: 18431, hash: 'a3…4c1' },
          ].map((e) => (
            <div
              key={e.seq}
              className="flex items-center justify-between py-1 text-[10px]"
            >
              <span className="font-mono text-neutral-500 tabular-nums">
                #{e.seq}
              </span>
              <span className="font-mono text-signal-500">{e.hash}</span>
              <span className="font-mono text-success">OK</span>
            </div>
          ))}
        </div>
      );
    case 'licence':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-neutral-500">PML 0241/2023</span>
            <span className="font-mono text-signal-500 tabular-nums">
              47 days
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-signal-500"
              style={{ width: '53%' }}
            />
          </div>
        </div>
      );
    case 'hedge':
      return (
        <div className="flex items-center gap-2 rounded-md border border-signal-500/30 bg-signal-500/5 px-3 py-2 text-[10px]">
          <span
            className="h-1.5 w-1.5 rounded-full bg-signal-500"
            aria-hidden="true"
          />
          <span className="font-mono text-neutral-300">LBMA AM-fix</span>
          <span className="ml-auto font-mono text-signal-500">+1.4%</span>
        </div>
      );
    case 'royalty':
      return (
        <div className="rounded-md border border-border bg-background/50 px-3 py-2 text-[10px]">
          <div className="text-neutral-500">April royalty draft</div>
          <div className="font-mono text-base font-semibold tabular-nums text-foreground">
            TZS 18.4M
          </div>
        </div>
      );
    case 'wallet':
      return (
        <div className="grid grid-cols-3 gap-2">
          {['M-Pesa', 'Tigo Pesa', 'Airtel'].map((rail) => (
            <div
              key={rail}
              className="rounded-md border border-border bg-background/50 px-2 py-1.5 text-center text-[10px]"
            >
              <div className="font-semibold text-foreground">{rail}</div>
              <div className="font-mono text-success">live</div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}
