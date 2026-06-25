'use client';

import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import { licenceCockpitStrings as S } from '@/i18n/strings/licence-cockpit';

interface CountdownCardsProps {
  readonly daysToWindow: number;
  readonly windowOpensAt: string;
  readonly windowClosesAt: string;
}

interface Threshold {
  readonly key: 'T-90' | 'T-30' | 'T-7';
  readonly days: number;
  readonly tone: 'green' | 'amber' | 'red';
}

const THRESHOLDS: ReadonlyArray<Threshold> = [
  { key: 'T-90', days: 90, tone: 'green' },
  { key: 'T-30', days: 30, tone: 'amber' },
  { key: 'T-7', days: 7, tone: 'red' },
];

const TONE_CLASS: Record<Threshold['tone'], string> = {
  green: 'border-success/40 bg-success-subtle/20 text-success',
  amber: 'border-warning/40 bg-warning-subtle/20 text-warning',
  red: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export function CountdownCards({
  daysToWindow,
  windowOpensAt,
  windowClosesAt,
}: CountdownCardsProps) {
  const locale = useLocale();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {THRESHOLDS.map((t) => {
        const reached = daysToWindow <= t.days;
        return (
          <article
            key={t.key}
            className={`rounded-md border px-4 py-3 ${
              reached
                ? TONE_CLASS[t.tone]
                : 'border-border bg-surface text-neutral-400'
            }`}
          >
            <div className="text-tiny uppercase tracking-wide">
              {pickByLocale(locale, S.countdown.gate(t.key))}
            </div>
            <div className="mt-1 text-2xl font-display">
              {reached
                ? pickByLocale(locale, S.countdown.reached)
                : pickByLocale(locale, S.countdown.daysToGo(daysToWindow - t.days))}
            </div>
            <div className="mt-1 text-badge">
              {pickByLocale(
                locale,
                S.countdown.window(windowOpensAt, windowClosesAt),
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
