import {
  CalendarRange,
  Sunrise,
  Pickaxe,
  Coins,
  Store,
  ShieldCheck,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * CapabilitiesGrid — six mining-tuned capability cards.
 *
 * One row per category that mining operators recognise at a glance:
 * licence calendar, daily brief, drill-hole logger, FX & treasury,
 * marketplace, compliance pack. Each card stays under three lines so
 * the wall reads as one calm grid, not a feature dump.
 */
export function CapabilitiesGrid({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).capabilities;
  const cards = [
    { id: 'licence', icon: CalendarRange, ...t.cards.licence },
    { id: 'brief', icon: Sunrise, ...t.cards.brief },
    { id: 'drillhole', icon: Pickaxe, ...t.cards.drillhole },
    { id: 'treasury', icon: Coins, ...t.cards.treasury },
    { id: 'marketplace', icon: Store, ...t.cards.marketplace },
    { id: 'compliance', icon: ShieldCheck, ...t.cards.compliance },
  ];

  return (
    <section
      id="product"
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="capabilities-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="capabilities-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[54ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <ul className="mt-14 grid gap-px rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <li
              key={c.id}
              className="group relative flex flex-col gap-4 bg-surface p-7 transition-colors duration-fast hover:bg-surface-raised"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-signal-500/25 bg-signal-500/5 text-signal-500 transition-all duration-base ease-out group-hover:border-signal-500/50 group-hover:shadow-[0_0_24px_-8px_hsl(var(--signal-500)/0.6)]">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-xl font-medium tracking-tight">
                  {c.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  {c.blurb}
                </p>
              </div>
              <span className="absolute right-5 top-5 font-mono text-[0.65rem] uppercase tracking-widest text-neutral-500">
                {String(i + 1).padStart(2, '0')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
