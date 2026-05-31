'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import type { ChartElementProps } from './ChartElementChart';

export type { ChartElementProps };

const LazyChartElementChart = dynamic(
  () => import('./ChartElementChart.js').then((m) => m.ChartElementChart),
  { ssr: false, loading: () => null },
);

/**
 * Lazy, code-split wrapper around the recharts-backed chart element.
 * Keeps recharts (~5 MB) out of the initial bundle — the chunk loads
 * only when a chart element actually renders on the blackboard. The
 * box reserves the chart's height so deferring causes no layout shift.
 * Consumers import `{ ChartElement }` from here exactly as before.
 */
export function ChartElement(props: ChartElementProps): ReactElement {
  const reservedHeight = (props.payload.height ?? 220) + 44;
  return (
    <div style={{ minHeight: reservedHeight }}>
      <LazyChartElementChart {...props} />
    </div>
  );
}
