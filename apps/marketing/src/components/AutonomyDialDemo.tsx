'use client';

import { useState } from 'react';
import { Gauge, LockKeyhole, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * AutonomyDialDemo — four-stop interactive dial.
 *
 * Advise → Propose → Execute-with-approval → Autonomous. Capability
 * grid below the dial reshades as the user drags. Red-line actions
 * (royalty filing, NEMC submissions, gold sales over 200 oz) never
 * cross to autonomous — the lock badge stays on regardless of level.
 */
export function AutonomyDialDemo({ locale }: { readonly locale: Locale }) {
  const [level, setLevel] = useState(1);
  const t = getMessages(locale).autonomy;
  const labels = t.labels;
  const capabilities = t.capabilities;
  const blurb = [t.levels.advise, t.levels.propose, t.levels.executeWithApproval, t.levels.autonomous][level];

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="autonomy-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="autonomy-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <div className="mt-14 grid gap-8 rounded-2xl border border-border bg-surface p-8 lg:grid-cols-[1fr_1.5fr] lg:p-10">
        <div className="flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-signal-500" />
              <span className="font-mono text-xs uppercase tracking-widest text-neutral-400">
                {labels.dialLabel}
              </span>
            </div>
            <p className="mt-2 font-mono text-5xl font-medium tabular-nums leading-none">
              0{level}
            </p>
            <p className="mt-3 font-display text-2xl font-medium leading-tight tracking-tight">
              {labels.steps[level]}
            </p>
            <p className="mt-2 text-sm text-neutral-400">{blurb}</p>
          </div>

          <div className="mt-8">
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="accent-signal-500 w-full"
              aria-label={labels.dialLabel}
            />
            <div className="mt-2 grid grid-cols-4 font-mono text-[0.65rem] uppercase tracking-widest text-neutral-400">
              {labels.steps.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-signal-500/20 bg-signal-500/5 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-signal-500" />
              <span className="font-mono text-[0.68rem] uppercase tracking-widest text-signal-500">
                {labels.redLineKicker}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {labels.redLineBody}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {capabilities.map((c) => {
            const redLine = c.minLevel === 99;
            const allowed = level >= c.minLevel && !redLine;
            return (
              <div
                key={c.id}
                className={[
                  'flex items-center gap-3 rounded-lg border p-3.5 transition-all duration-base ease-out',
                  redLine && 'border-destructive/30 bg-destructive/10',
                  allowed && !redLine && 'border-signal-500/40 bg-signal-500/5',
                  !allowed && !redLine && 'border-border bg-surface-raised opacity-60',
                ].filter(Boolean).join(' ')}
              >
                <span
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                    redLine && 'bg-destructive/15 text-destructive',
                    allowed && !redLine && 'bg-signal-500/15 text-signal-500',
                    !allowed && !redLine && 'bg-neutral-700/40 text-neutral-400',
                  ].filter(Boolean).join(' ')}
                >
                  {redLine ? (
                    <LockKeyhole className="h-4 w-4" />
                  ) : allowed ? (
                    <Sparkles className="h-4 w-4" />
                  ) : (
                    <UsersRound className="h-4 w-4" />
                  )}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-widest text-neutral-400">
                    {redLine
                      ? labels.redLineTag
                      : allowed
                      ? labels.autonomousTag
                      : `${labels.unlocksAtL} ${c.minLevel}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
