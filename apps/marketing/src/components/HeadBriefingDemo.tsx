import type { ReactNode } from 'react';
import { Clock, Sunrise, AlertTriangle, TrendingUp, FileWarning } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

type Tone = 'good' | 'warn' | 'flag';

/**
 * HeadBriefingDemo — animated mock of the daily brief stream.
 *
 * No JS / no LLM — staggered CSS keyframe animation (.brief-line) gives
 * each line a half-second fade-up cascade. Content is mining-realistic:
 * Geita night-shift output, Mererani vendor flag, PML expiry warning,
 * Mining Commission royalty return draft. Lines are content-only so a
 * screen-reader user reads the same brief, just instantly.
 */
export function HeadBriefingDemo({ locale }: { readonly locale: Locale }) {
  const messages = getMessages(locale);
  const t = messages.brief;
  const demo = t.demo;

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
        <p className="mx-auto mt-5 max-w-prose-tight text-lg leading-relaxed text-neutral-400">
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
              {demo.greeting}
            </h3>
            <p className="mt-2 text-sm text-neutral-400">{demo.intro}</p>

            <dl className="mt-6 space-y-3">
              <Stat label={demo.stats.overnightActions} value="47" trend="up" delta="+8" />
              <Stat label={demo.stats.decisions} value="3" trend="down" delta="-2" />
              <Stat label={demo.stats.goldOz} value="184" trend="up" delta="+12.4" />
              <Stat label={demo.stats.cashTzs} value="412M" trend="up" delta="+1.2%" />
            </dl>
          </aside>

          <div className="flex flex-col p-6">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Sunrise className="h-4 w-4 text-signal-500" />
              <span className="font-mono text-xs uppercase tracking-widest text-signal-500">
                {demo.streamingLabel}
              </span>
            </div>
            <ol className="mt-4 space-y-3">
              {demo.lines.map((l, i) => (
                <li
                  key={i}
                  className="brief-line group flex items-start gap-4 rounded-lg border border-transparent p-3 transition-colors duration-fast hover:border-border hover:bg-surface-raised"
                  style={{ animationDelay: `${i * 0.18}s` }}
                >
                  <span className={tagClass(l.tone as Tone)}>{l.tag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-meta uppercase tracking-widest text-neutral-400">
                        {l.domain}
                      </span>
                      <span className="font-mono text-meta text-neutral-500">· {l.time}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-foreground">{l.body}</p>
                  </div>
                  {iconForLine(l.tone as Tone, l.tag, l.domain)}
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
      <dt className="font-mono text-meta uppercase tracking-widest text-neutral-400">{label}</dt>
      <dd className="mt-1 flex items-baseline justify-between">
        <span className="font-display text-2xl font-medium tracking-tight tabular-nums">{value}</span>
        <span
          className={[
            'rounded-full px-1.5 py-0.5 font-mono text-caption-lg',
            positive ? 'bg-success-subtle text-success' : 'bg-destructive/15 text-destructive',
          ].join(' ')}
        >
          {delta}
        </span>
      </dd>
    </div>
  );
}

function tagClass(tone: Tone) {
  if (tone === 'warn')
    return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/10 font-mono text-micro-num font-semibold text-warning';
  if (tone === 'flag')
    return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 font-mono text-micro-num font-semibold text-destructive';
  return 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-500/10 font-mono text-micro-num font-semibold text-signal-500';
}

function iconForLine(tone: Tone, tag: string, domain: string): ReactNode {
  if (tag === 'TX') return <TrendingUp className="h-4 w-4 text-success opacity-0 group-hover:opacity-100" />;
  if (tone === 'warn' && tag === '!') {
    if (domain.includes('PML')) {
      return <FileWarning className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />;
    }
    return <AlertTriangle className="h-4 w-4 text-warning opacity-0 group-hover:opacity-100" />;
  }
  return null;
}
