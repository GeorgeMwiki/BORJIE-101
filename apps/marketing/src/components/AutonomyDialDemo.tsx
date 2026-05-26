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
  const labels = labelCopy(locale);

  const capabilities = capabilityCopy(locale);
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

function labelCopy(locale: Locale) {
  if (locale === 'sw') {
    return {
      dialLabel: 'Ngazi ya uhuru',
      steps: ['Shauri', 'Andaa', 'Tekeleza kwa idhini', 'Otomatiki'],
      redLineKicker: 'Mstari mwekundu',
      redLineBody:
        'Master Brain haweti kamwe royalty TRA peke yake, hatumi NEMC EIA peke yake, na hauziwi dhahabu zaidi ya uncia 200 bila idhini ya mtumiaji. Si kwa ngazi yoyote.',
      redLineTag: 'Mstari mwekundu · siyo otomatiki',
      autonomousTag: 'Otomatiki kwenye ngazi hii',
      unlocksAtL: 'Inafunguliwa L',
    };
  }
  return {
    dialLabel: 'Autonomy level',
    steps: ['Advise', 'Propose', 'Execute-with-approval', 'Autonomous'],
    redLineKicker: 'Red-line guarantee',
    redLineBody:
      'The Master Brain never auto-files royalty to TRA, never auto-submits NEMC EIA, and never auto-sells gold above 200 oz. At any autonomy level. Ever.',
    redLineTag: 'Red-line · never autonomous',
    autonomousTag: 'Autonomous at this level',
    unlocksAtL: 'Unlocks at L',
  };
}

function capabilityCopy(locale: Locale) {
  const sw = [
    { id: 'price', label: 'Andika daily price brief', minLevel: 0 },
    { id: 'shift', label: 'Toa shift handover report', minLevel: 1 },
    { id: 'vendor', label: 'Lipa vendor PO ndogo (< TZS 5M)', minLevel: 2 },
    { id: 'hedge', label: 'Funga FX hedge ya wiki', minLevel: 2 },
    { id: 'pml', label: 'Wasilisha PML renewal Tumemadini', minLevel: 99 },
    { id: 'royalty', label: 'Wasilisha royalty TRA', minLevel: 99 },
    { id: 'nemc', label: 'Wasilisha NEMC EIA', minLevel: 99 },
    { id: 'sale', label: 'Uza dhahabu > 200 oz', minLevel: 99 },
  ];
  const en = [
    { id: 'price', label: 'Draft daily price brief', minLevel: 0 },
    { id: 'shift', label: 'Issue shift handover report', minLevel: 1 },
    { id: 'vendor', label: 'Settle small vendor POs (< TZS 5M)', minLevel: 2 },
    { id: 'hedge', label: 'Place weekly FX hedge', minLevel: 2 },
    { id: 'pml', label: 'File PML renewal to Tumemadini', minLevel: 99 },
    { id: 'royalty', label: 'File royalty return to TRA', minLevel: 99 },
    { id: 'nemc', label: 'Submit NEMC EIA', minLevel: 99 },
    { id: 'sale', label: 'Sell gold > 200 oz', minLevel: 99 },
  ];
  return locale === 'sw' ? sw : en;
}
