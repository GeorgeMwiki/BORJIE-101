import { Clock, Sunrise, AlertTriangle, TrendingUp, FileWarning } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * HeadBriefingDemo — animated mock of the daily brief stream.
 *
 * No JS / no LLM — staggered CSS keyframe animation (.brief-line) gives
 * each line a half-second fade-up cascade. Content is mining-realistic:
 * Geita night-shift output, Mererani vendor flag, PML expiry warning,
 * Tumemadini royalty return draft. Lines are content-only so a
 * screen-reader user reads the same brief, just instantly.
 */
export function HeadBriefingDemo({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).brief;
  const lines = lineCopy(locale);

  return (
    <section
      id="brief"
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="brief-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="brief-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <div className="mt-14 rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center gap-4 border-b border-border px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-neutral-700" />
            <span className="h-3 w-3 rounded-full bg-neutral-700" />
            <span className="h-3 w-3 rounded-full bg-neutral-700" />
          </div>
          <div className="mx-auto flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-1 font-mono text-xs text-neutral-400">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            owner.borjie.co.tz / briefing
          </div>
          <div className="w-16" />
        </div>

        <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-border p-6 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-neutral-400">
              <Clock className="h-3.5 w-3.5" /> 06:04 · Dar es Salaam
            </div>
            <h3 className="mt-4 font-display text-2xl font-medium leading-tight tracking-tight">
              {locale === 'sw' ? 'Habari za asubuhi, Mwl. Salim.' : 'Good morning, Mr. Salim.'}
            </h3>
            <p className="mt-2 text-sm text-neutral-400">
              {locale === 'sw'
                ? 'Mgodi ni shwari. Maamuzi matatu yanahitajika kabla ya 09:00.'
                : 'Mine is calm. Three decisions need you before 09:00.'}
            </p>

            <dl className="mt-6 space-y-3">
              <Stat label={locale === 'sw' ? 'Vitendo vya usiku' : 'Overnight actions'} value="47" trend="up" delta="+8" />
              <Stat label={locale === 'sw' ? 'Maamuzi' : 'Decisions'} value="3" trend="down" delta="-2" />
              <Stat label={locale === 'sw' ? 'Dhahabu (oz)' : 'Gold (oz)'} value="184" trend="up" delta="+12.4" />
              <Stat label={locale === 'sw' ? 'Hazina (TZS)' : 'Cash (TZS)'} value="412M" trend="up" delta="+1.2%" />
            </dl>
          </aside>

          <div className="flex flex-col p-6">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Sunrise className="h-4 w-4 text-signal-500" />
              <span className="font-mono text-xs uppercase tracking-widest text-signal-500">
                {locale === 'sw' ? 'Streaming · usiku wa 25 Mei' : 'Streaming · night of 25 May'}
              </span>
            </div>
            <ol className="mt-4 space-y-3">
              {lines.map((l, i) => (
                <li
                  key={i}
                  className="brief-line group flex items-start gap-4 rounded-lg border border-transparent p-3 transition-colors duration-fast hover:border-border hover:bg-surface-raised"
                  style={{ animationDelay: `${i * 0.18}s` }}
                >
                  <span className={tagClass(l.tone)}>{l.tag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[0.68rem] uppercase tracking-widest text-neutral-400">
                        {l.domain}
                      </span>
                      <span className="font-mono text-[0.68rem] text-neutral-500">· {l.time}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-foreground">{l.body}</p>
                  </div>
                  {l.icon}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- */

function Stat({
  label,
  value,
  delta,
  trend,
}: {
  readonly label: string;
  readonly value: string;
  readonly delta: string;
  readonly trend: 'up' | 'down';
}) {
  const positive = trend === 'up';
  return (
    <div className="border-l border-border pl-3">
      <dt className="font-mono text-[0.68rem] uppercase tracking-widest text-neutral-400">{label}</dt>
      <dd className="mt-1 flex items-baseline justify-between">
        <span className="font-display text-2xl font-medium tracking-tight tabular-nums">{value}</span>
        <span
          className={[
            'rounded-full px-1.5 py-0.5 font-mono text-[0.65rem]',
            positive ? 'bg-success-subtle text-success' : 'bg-destructive/15 text-destructive',
          ].join(' ')}
        >
          {delta}
        </span>
      </dd>
    </div>
  );
}

function tagClass(tone: 'good' | 'warn' | 'flag') {
  if (tone === 'warn')
    return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/10 font-mono text-[0.6rem] font-semibold text-warning';
  if (tone === 'flag')
    return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 font-mono text-[0.6rem] font-semibold text-destructive';
  return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-500/10 font-mono text-[0.6rem] font-semibold text-signal-500';
}

function lineCopy(locale: Locale) {
  if (locale === 'sw') {
    return [
      {
        time: '22:14',
        domain: 'Geita pit · shift B',
        body: 'Shift B walitoa tani 184. Grade ya 3.2 g/t. Imehifadhiwa kwenye drill-hole log MR-241.',
        tone: 'good' as const,
        tag: 'OK',
        icon: null,
      },
      {
        time: '23:47',
        domain: 'Mererani vendor',
        body: 'Vendor "Kahama Logistics" amechelewa malipo ya tani 12. Imepelekwa kwa wewe kwa idhini ya extension.',
        tone: 'warn' as const,
        tag: '!',
        icon: <AlertTriangle className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />,
      },
      {
        time: '01:33',
        domain: 'PML 0241/2023 · Kahama',
        body: 'Leseni inaisha kwa siku 47. Tumemadini renewal form imeandaliwa kwa review yako.',
        tone: 'warn' as const,
        tag: '!',
        icon: <FileWarning className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />,
      },
      {
        time: '03:05',
        domain: 'Treasury · gold-window',
        body: 'Spot ya LBMA imepanda 1.4% ndani ya saa 6. Hedge proposal ya uncia 60 imeandaliwa.',
        tone: 'good' as const,
        tag: 'TX',
        icon: <TrendingUp className="h-4 w-4 text-success opacity-0 group-hover:opacity-100" />,
      },
      {
        time: '04:18',
        domain: 'NEMC EIA · Songwe',
        body: 'Quarterly emissions report imewasilishwa kwa NEMC. Acknowledgement #2604-A.',
        tone: 'good' as const,
        tag: 'OK',
        icon: null,
      },
      {
        time: '05:42',
        domain: 'Royalty return · TRA',
        body: 'Royalty ya Aprili imeandaliwa: TZS 18.4M. Inahitaji saini yako kabla ya kupelekwa.',
        tone: 'flag' as const,
        tag: 'YOU',
        icon: null,
      },
    ];
  }
  return [
    {
      time: '22:14',
      domain: 'Geita pit · shift B',
      body: 'Shift B delivered 184 t at 3.2 g/t. Logged to drill-hole log MR-241.',
      tone: 'good' as const,
      tag: 'OK',
      icon: null,
    },
    {
      time: '23:47',
      domain: 'Mererani vendor',
      body: 'Vendor "Kahama Logistics" delayed payment on 12 t. Routed to you for extension approval.',
      tone: 'warn' as const,
      tag: '!',
      icon: <AlertTriangle className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />,
    },
    {
      time: '01:33',
      domain: 'PML 0241/2023 · Kahama',
      body: 'Licence expires in 47 days. Tumemadini renewal form drafted for your review.',
      tone: 'warn' as const,
      tag: '!',
      icon: <FileWarning className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />,
    },
    {
      time: '03:05',
      domain: 'Treasury · gold-window',
      body: 'LBMA spot up 1.4% inside 6 hours. Hedge proposal for 60 oz drafted.',
      tone: 'good' as const,
      tag: 'TX',
      icon: <TrendingUp className="h-4 w-4 text-success opacity-0 group-hover:opacity-100" />,
    },
    {
      time: '04:18',
      domain: 'NEMC EIA · Songwe',
      body: 'Quarterly emissions report submitted to NEMC. Acknowledgement #2604-A.',
      tone: 'good' as const,
      tag: 'OK',
      icon: null,
    },
    {
      time: '05:42',
      domain: 'Royalty return · TRA',
      body: 'April royalty drafted: TZS 18.4M. Needs your signature before filing.',
      tone: 'flag' as const,
      tag: 'YOU',
      icon: null,
    },
  ];
}
