import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  FileSignature,
  FileText,
  ShieldCheck,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { TiltCard } from '@/components/animations/TiltCard';

/**
 * CapabilitiesGrid — six capability cards wrapped in TiltCard so each
 * card responds to mouse position with a subtle 3D tilt (max 6deg,
 * disabled on touch + reduced-motion).
 *
 * Cards use lucide icons that map to each capability's mining-domain
 * meaning: FileText for the licence calendar, FileSignature for the
 * royalty drafter, TrendingUp for treasury, Boxes for the marketplace,
 * Users for the workforce console, ShieldCheck for the compliance pack.
 */

interface CardDef {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly blurb: string;
  readonly href: string;
}

export function CapabilitiesGrid({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).capabilities;
  const cards: readonly CardDef[] = [
    {
      id: 'licence',
      icon: FileText,
      title: t.cards.licence.title,
      blurb: t.cards.licence.blurb,
      href: '/#licence',
    },
    {
      id: 'royalty',
      icon: FileSignature,
      title: t.cards.compliance.title,
      blurb: t.cards.compliance.blurb,
      href: '/#royalty',
    },
    {
      id: 'treasury',
      icon: TrendingUp,
      title: t.cards.treasury.title,
      blurb: t.cards.treasury.blurb,
      href: '/#treasury',
    },
    {
      id: 'marketplace',
      icon: Boxes,
      title: t.cards.marketplace.title,
      blurb: t.cards.marketplace.blurb,
      href: '/#marketplace',
    },
    {
      id: 'workforce',
      icon: Users,
      title: t.cards.drillhole.title,
      blurb: t.cards.drillhole.blurb,
      href: '/#workforce',
    },
    {
      id: 'compliance',
      icon: ShieldCheck,
      title: t.cards.brief.title,
      blurb: t.cards.brief.blurb,
      href: '/#compliance',
    },
  ];

  return (
    <section
      id="product"
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-10 lg:px-8"
      aria-labelledby="capabilities-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="capabilities-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-prose text-lg leading-relaxed text-foreground/70">
          {t.sub}
        </p>
      </div>

      <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <li key={c.id} className="h-full">
              <TiltCard className="h-full">
                <div className="group relative flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-7 transition-colors duration-fast hover:bg-surface-raised">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-signal-500/25 bg-signal-500/5 text-signal-500 transition-all duration-base ease-out group-hover:border-signal-500/50 group-hover:shadow-signal-glow">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="flex-1">
                    <h3 className="font-display text-xl font-medium tracking-tight">
                      {c.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/70">
                      {c.blurb}
                    </p>
                  </div>
                  <Link
                    href={c.href}
                    className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-signal-500 transition-colors hover:text-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background"
                  >
                    {t.learnMore}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                  <span className="absolute right-5 top-5 font-mono text-caption-lg uppercase tracking-widest text-foreground/60">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              </TiltCard>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
