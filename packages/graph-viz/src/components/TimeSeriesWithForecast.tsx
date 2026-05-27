'use client';

/**
 * TimeSeriesWithForecast — historical + point forecast + 80%/95%
 * prediction intervals on a single chart.
 *
 * Self-rendered SVG (no chart-lib lock-in) keeps the package's peer
 * surface small. The shapes are a subset of `TimeSeriesForecast` from
 * `@borjie/forecasting` so this view is the canonical sink for
 * conformal-calibrated forecasts in chat/dashboards.
 *
 * Sources:
 *  - "Conformal prediction intervals in visualisation" —
 *    https://www.darts.unit8.co/userguide/forecasting_overview.html (Unit8 Darts, 2025-04)
 *  - Observable Plot 0.6 — https://observablehq.com/plot (2025-06)
 *  - "When to show 80% vs 95% intervals" — https://otexts.com/fpp3/prediction-intervals.html (Hyndman/Athanasopoulos, FPP3, 2026-03 edition)
 */

import { useMemo } from 'react';
import { getBrandTheme } from '../themes/oklch-brand-theme';
import type {
  TimeSeriesWithForecastProps,
  ForecastSeriesPoint,
  ForecastIntervalPoint,
} from '../types';

interface ScaledPoint {
  readonly cx: number;
  readonly cy: number;
}

export function TimeSeriesWithForecast(props: TimeSeriesWithForecastProps): JSX.Element {
  const {
    historical,
    forecast,
    seriesName,
    unit,
    height = 320,
    width = 720,
    themeName = 'brand-light',
    ariaLabel,
    testId,
  } = props;

  const theme = getBrandTheme(themeName);
  const padding = { top: 16, right: 24, bottom: 28, left: 48 };

  const { xScale, yScale, histPath, forecastPath, band80Path, band95Path, lastHist, firstForecast } = useMemo(() => {
    const allPoints: Array<{ t: string; y: number }> = [
      ...historical.map((p) => ({ t: p.t, y: p.y })),
      ...forecast.map((p) => ({ t: p.t, y: p.point })),
    ];
    if (allPoints.length === 0) {
      return {
        xScale: (_: number) => 0,
        yScale: (_: number) => 0,
        histPath: '',
        forecastPath: '',
        band80Path: '',
        band95Path: '',
        lastHist: null as ScaledPoint | null,
        firstForecast: null as ScaledPoint | null,
      };
    }

    const minT = new Date(allPoints[0]!.t).getTime();
    const maxT = new Date(allPoints[allPoints.length - 1]!.t).getTime();
    const ys: number[] = [
      ...historical.map((p) => p.y),
      ...forecast.flatMap((p) => [
        p.point,
        ...(typeof p.lower95 === 'number' ? [p.lower95] : []),
        ...(typeof p.upper95 === 'number' ? [p.upper95] : []),
        ...(typeof p.lower80 === 'number' ? [p.lower80] : []),
        ...(typeof p.upper80 === 'number' ? [p.upper80] : []),
      ]),
    ];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const ySpan = (maxY - minY) || 1;

    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const xScaleFn = (ms: number) =>
      padding.left + ((ms - minT) / Math.max(1, maxT - minT)) * innerW;
    const yScaleFn = (val: number) =>
      padding.top + innerH - ((val - minY) / ySpan) * innerH;

    const histLine = historical.map((p, i) => {
      const x = xScaleFn(new Date(p.t).getTime());
      const y = yScaleFn(p.y);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');

    const forecastLine = forecast.map((p, i) => {
      const x = xScaleFn(new Date(p.t).getTime());
      const y = yScaleFn(p.point);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');

    const band = (ks: ReadonlyArray<ForecastIntervalPoint>, lo: 'lower80' | 'lower95', hi: 'upper80' | 'upper95'): string => {
      const hasBand = ks.every((p) => typeof p[lo] === 'number' && typeof p[hi] === 'number');
      if (!hasBand) return '';
      const top = ks.map((p, i) => {
        const x = xScaleFn(new Date(p.t).getTime());
        const y = yScaleFn(p[hi] as number);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      }).join(' ');
      const bottom = [...ks].reverse().map((p) => {
        const x = xScaleFn(new Date(p.t).getTime());
        const y = yScaleFn(p[lo] as number);
        return `L${x},${y}`;
      }).join(' ');
      return `${top} ${bottom} Z`;
    };

    const lastHistPt = historical.length > 0 ? {
      cx: xScaleFn(new Date(historical[historical.length - 1]!.t).getTime()),
      cy: yScaleFn(historical[historical.length - 1]!.y),
    } : null;

    const firstFcPt = forecast.length > 0 ? {
      cx: xScaleFn(new Date(forecast[0]!.t).getTime()),
      cy: yScaleFn(forecast[0]!.point),
    } : null;

    return {
      xScale: xScaleFn,
      yScale: yScaleFn,
      histPath: histLine,
      forecastPath: forecastLine,
      band80Path: band(forecast, 'lower80', 'upper80'),
      band95Path: band(forecast, 'lower95', 'upper95'),
      lastHist: lastHistPt,
      firstForecast: firstFcPt,
    };
  }, [historical, forecast, width, height, padding.bottom, padding.left, padding.right, padding.top]);

  const labelUnit = unit ? ` (${unit})` : '';

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? 'graph-viz-timeseries-forecast'}
      width={width}
      height={height}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    >
      <title>{ariaLabel}</title>
      <desc>
        {`${seriesName}${labelUnit} — ${historical.length} historical points, ${forecast.length} forecast steps with 80% and 95% prediction intervals.`}
      </desc>
      {/* 95 band — outer */}
      {band95Path && (
        <path d={band95Path} fill={theme.sequential7[2]?.hex ?? theme.signal.hex} fillOpacity={0.18} stroke="none" />
      )}
      {/* 80 band — inner */}
      {band80Path && (
        <path d={band80Path} fill={theme.sequential7[3]?.hex ?? theme.signal.hex} fillOpacity={0.32} stroke="none" />
      )}
      {/* Historical line */}
      <path d={histPath} fill="none" stroke={theme.foreground.hex} strokeWidth={1.6} />
      {/* Forecast line */}
      <path d={forecastPath} fill="none" stroke={theme.signal.hex} strokeWidth={1.8} strokeDasharray="4 3" />
      {/* Join dot between historical and forecast */}
      {lastHist && firstForecast && (
        <line
          x1={lastHist.cx} y1={lastHist.cy}
          x2={firstForecast.cx} y2={firstForecast.cy}
          stroke={theme.signal.hex}
          strokeWidth={1.6}
          strokeDasharray="2 2"
        />
      )}
      {/* Axes */}
      <line
        x1={padding.left} y1={height - padding.bottom}
        x2={width - padding.right} y2={height - padding.bottom}
        stroke={theme.border.hex}
      />
      <line
        x1={padding.left} y1={padding.top}
        x2={padding.left} y2={height - padding.bottom}
        stroke={theme.border.hex}
      />
      <text
        x={padding.left}
        y={padding.top - 4}
        fontSize={11}
        fill={theme.muted.hex}
      >
        {`${seriesName}${labelUnit}`}
      </text>
    </svg>
  );
}

// Re-export the input row types for convenience.
export type { ForecastSeriesPoint, ForecastIntervalPoint };
