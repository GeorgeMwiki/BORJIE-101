import { Check } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * HowItWorks — three-step onboarding arc.
 *
 * Editorial three-column layout. Steps name the actual integrations a
 * Tanzanian mining operator recognises (BRELA, TRA, Tumemadini) so the
 * adoption path reads as concrete, not aspirational.
 */
export function HowItWorks({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).how;
  const steps = [
    {
      n: '01',
      ...t.steps.one,
      bullets:
        locale === 'sw'
          ? [
              'BRELA · TRA · Tumemadini APIs',
              'KYB kamili ndani ya saa 48',
              'Sw au En kuanzia siku ya kwanza',
            ]
          : [
              'BRELA · TRA · Tumemadini APIs',
              'Full KYB inside 48 hours',
              'Swahili or English from day one',
            ],
    },
    {
      n: '02',
      ...t.steps.two,
      bullets:
        locale === 'sw'
          ? [
              'PML, ML, SML upload na OCR',
              'Ramani za pit kama GeoJSON au PDF',
              'Drill-hole logs kama CSV au laboratory PDF',
            ]
          : [
              'PML, ML, SML upload with OCR',
              'Pit maps as GeoJSON or PDF',
              'Drill-hole logs as CSV or laboratory PDF',
            ],
    },
    {
      n: '03',
      ...t.steps.three,
      bullets:
        locale === 'sw'
          ? [
              'Shadow mode kwa siku 14',
              'Autonomy dial — wewe unaongeza kasi',
              'Audit chain kwenye kila kitendo',
            ]
          : [
              '14-day shadow mode',
              'Autonomy dial — you set the pace',
              'Audit chain on every action',
            ],
    },
  ];

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="how-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="how-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
      </div>

      <ol className="mt-14 grid gap-px rounded-2xl border border-border bg-border md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="flex flex-col bg-surface p-8">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs uppercase tracking-widest text-signal-500">
                {s.label}
              </span>
              <span className="font-mono text-xs text-neutral-500">· {s.n}</span>
            </div>
            <h3 className="mt-4 font-display text-xl font-medium leading-tight tracking-tight text-balance">
              {s.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              {s.body}
            </p>
            <ul className="mt-5 space-y-2">
              {s.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
