'use client';

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
            <div className="text-[10px] uppercase tracking-wide">
              {t.key} renewal gate
            </div>
            <div className="mt-1 text-2xl font-display">
              {reached ? 'reached' : `${daysToWindow - t.days}d to go`}
            </div>
            <div className="mt-1 text-[11px]">
              window opens {windowOpensAt} · closes {windowClosesAt}
            </div>
          </article>
        );
      })}
    </div>
  );
}
