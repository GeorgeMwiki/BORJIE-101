'use client';

import dynamic from 'next/dynamic';
import type { SparklineProps } from './SparklineChart';

export type { SparklineProps };

const LazySparklineChart = dynamic(
  () => import('./SparklineChart.js').then((m) => m.SparklineChart),
  { ssr: false, loading: () => null },
);

/**
 * Lazy, code-split wrapper around the recharts-backed chart. Keeps the
 * ~5 MB recharts bundle out of the initial/SSR payload (it loads only
 * when a Sparkline actually mounts). The outer box reserves the chart's
 * height so deferring the chunk causes no layout shift. Consumers import
 * `{ Sparkline }` from here exactly as before — the laziness is internal.
 */
export function Sparkline(props: SparklineProps) {
  return (
    <div style={{ width: '100%', height: props.height ?? 64 }}>
      <LazySparklineChart {...props} />
    </div>
  );
}
