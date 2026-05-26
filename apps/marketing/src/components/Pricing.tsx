import Link from 'next/link';
import { Check, Star } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { TIERS, tierCta, tierFeatures, tierTagline } from '@/lib/pricing';

/**
 * Pricing — five Borjie tiers (Mwanzo · Mkulima · Mfanyabiashara ·
 * Kampuni · Group). Mfanyabiashara is the most-chosen highlight. All
 * tiers ship CTA chips that route to the pilot form.
 */
export function Pricing({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).pricing;

  return (
    <section
      id="pricing"
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="pricing-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="pricing-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {TIERS.map((tier) => {
          const features = tierFeatures(tier, locale);
          const tagline = tierTagline(tier, locale);
          const cta = tierCta(tier, locale);
          const showsPerMonth = tier.price.startsWith('TZS') && tier.price !== 'TZS 0';
          return (
            <article
              key={tier.id}
              className={[
                'flex flex-col rounded-2xl border p-6 transition-all duration-base ease-out',
                tier.highlighted
                  ? 'border-signal-500/40 bg-surface ring-1 ring-signal-500/30 shadow-[0_0_48px_-16px_hsl(var(--signal-500)/0.35)]'
                  : 'border-border bg-surface',
              ].join(' ')}
            >
              <header>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-xl font-medium tracking-tight">
                    {tier.name}
                  </h3>
                  {tier.highlighted && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-signal-500/15 px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-signal-500">
                      <Star className="h-2.5 w-2.5" />
                      {locale === 'sw' ? 'Wengi' : 'Most chosen'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-neutral-400">{tagline}</p>
              </header>

              <div className="mt-5">
                <p className="font-display text-3xl font-medium leading-none tracking-tight tabular-nums">
                  {tier.price === 'TZS 0' ? (
                    <span>
                      TZS 0<span className="text-base text-neutral-400"> / {t.freeForever}</span>
                    </span>
                  ) : tier.price === 'Bespoke' ? (
                    <span>{t.bespoke}</span>
                  ) : (
                    <span>
                      {tier.price}
                      {showsPerMonth && (
                        <span className="text-base text-neutral-400">/{t.perMonth.split(' ')[1] ?? 'mo'}</span>
                      )}
                    </span>
                  )}
                </p>
              </div>

              <Link
                href={tier.href}
                className={[
                  'mt-6 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold transition-all duration-fast ease-out active:scale-[0.98]',
                  tier.highlighted
                    ? 'bg-signal-500 text-primary-foreground shadow-md hover:bg-signal-400 hover:shadow-lg'
                    : 'border border-border text-foreground hover:bg-surface-raised',
                ].join(' ')}
              >
                {cta}
              </Link>

              <ul className="mt-6 space-y-2 border-t border-border pt-5">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" />
                    <span className="text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-neutral-400">{t.footnote}</p>
    </section>
  );
}
