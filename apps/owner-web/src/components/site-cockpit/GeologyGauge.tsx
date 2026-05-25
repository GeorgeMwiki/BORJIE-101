'use client';

import { Sparkline } from '@/components/shared/Sparkline';

interface GeologyGaugeProps {
  readonly score: number;
  readonly trend: ReadonlyArray<{ readonly day: number; readonly score: number }>;
}

export function GeologyGauge({ score, trend }: GeologyGaugeProps) {
  const tone: 'green' | 'amber' | 'red' =
    score >= 70 ? 'green' : score >= 50 ? 'amber' : 'red';
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Geology composite score
      </div>
      <div className="mt-2 flex items-end gap-4">
        <div>
          <div className="text-5xl font-display text-foreground">{score}</div>
          <div className="mt-0.5 text-xs text-neutral-500">
            scale 0–100 (drill density · QA/QC · vein continuity)
          </div>
        </div>
        <div className="flex-1">
          <Sparkline
            data={trend.map((t) => ({ x: t.day, y: t.score }))}
            tone={tone}
            height={70}
            tooltipFormatter={(v) => `${v}`}
          />
        </div>
      </div>
    </article>
  );
}
