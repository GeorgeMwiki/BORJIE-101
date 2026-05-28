'use client';

/**
 * MiniMetricBlock — single live KPI chip rendered inline in the bubble.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `miniMetricSchema`. Compact one-line chip: name + value + optional
 * delta + optional 12-point sparkline.
 *
 * LitFin rhythm: 12px label, mono numerics, tone-coded delta.
 */

import type { ReactElement } from 'react';

export interface MiniMetricBlock {
  readonly type: 'mini_metric';
  readonly name?: string;
  readonly value?: string;
  readonly delta?: string;
  readonly tone?: 'positive' | 'neutral' | 'warning';
  readonly sparkline?: ReadonlyArray<number>;
  readonly [extra: string]: unknown;
}

export interface MiniMetricBlockProps {
  readonly block: MiniMetricBlock;
  readonly locale: 'sw' | 'en';
}

const TONE_CLASS: Readonly<Record<NonNullable<MiniMetricBlock['tone']>, string>> = {
  positive: 'border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300',
  neutral: 'border-border bg-surface/60 text-foreground',
  warning: 'border-destructive/40 bg-destructive/[0.08] text-destructive',
};

function Sparkline({
  points,
}: {
  readonly points: ReadonlyArray<number>;
}): ReactElement | null {
  if (points.length < 2) return null;
  const width = 60;
  const height = 18;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="opacity-70"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function MiniMetricBlock({
  block,
  locale,
}: MiniMetricBlockProps): ReactElement {
  const tone = block.tone ?? 'neutral';
  const toneClass = TONE_CLASS[tone];
  const label =
    typeof block.name === 'string' && block.name.trim().length > 0
      ? block.name
      : locale === 'sw'
        ? 'Kipimo'
        : 'Metric';
  const value =
    typeof block.value === 'string' && block.value.trim().length > 0
      ? block.value
      : '—';
  const delta =
    typeof block.delta === 'string' && block.delta.trim().length > 0
      ? block.delta
      : null;
  const sparkline = Array.isArray(block.sparkline)
    ? block.sparkline.filter((p): p is number => typeof p === 'number')
    : null;

  return (
    <div
      data-testid="inline-block-mini-metric"
      className={`inline-flex w-full items-center gap-3 rounded-xl border px-3 py-2 ${toneClass}`}
    >
      <span className="text-tiny font-medium uppercase tracking-wide opacity-70">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums">
        {value}
      </span>
      {delta ? (
        <span className="font-mono text-tiny tabular-nums opacity-80">
          {delta}
        </span>
      ) : null}
      {sparkline && sparkline.length >= 2 ? <Sparkline points={sparkline} /> : null}
    </div>
  );
}
