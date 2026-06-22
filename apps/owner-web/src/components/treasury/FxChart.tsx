'use client';

/**
 * FX & gold price chart — wired to the live fx-feed cron via
 * `/api/v1/mining/fx/{latest,history}`.
 *
 * Top row: three cards summarising the latest TZS/USD, gold AM fix,
 * gold PM fix. Bottom row: a minimal SVG sparkline for TZS/USD over
 * the last 60 ticks. Degraded state stays graceful — when no rows yet
 * the card shows "FX feed warming up" instead of crashing.
 *
 * Every label renders in the ACTIVE locale (`label[locale]`) — the pair
 * glosses are bilingual and the surrounding chrome flows through the
 * treasury-page string table, so an `sw` user never sees an `en` gloss.
 */

import { useMemo } from 'react';
import { useFxLatest, useFxHistory } from '@/lib/queries/fx';
import type { FxLatestRate, FxHistoryPoint } from '@/lib/queries/fx';
import type { Locale } from '@/lib/locale-shared';
import { pickByLocale } from '@/lib/locale-shared';
import { bcp47For } from '@/lib/format';
import { treasuryPageStrings as S } from '@/i18n/strings/treasury-page';

interface FxChartProps {
  readonly locale: Locale;
}

const PAIR_LABEL: Record<string, { en: string; sw: string; unit: string }> = {
  TZS_USD: { en: 'TZS / USD', sw: 'TZS / USD', unit: 'TZS' },
  XAU_USD_AM: { en: 'Gold AM fix', sw: 'Dhahabu (asubuhi)', unit: 'USD/oz' },
  XAU_USD_PM: { en: 'Gold PM fix', sw: 'Dhahabu (mchana)', unit: 'USD/oz' },
};

function formatRate(rate: number, locale: Locale): string {
  return rate.toLocaleString(bcp47For(locale), { maximumFractionDigits: 2 });
}

export function FxChart({ locale }: FxChartProps): JSX.Element {
  const latestQuery = useFxLatest();
  const historyQuery = useFxHistory('TZS_USD', 60);

  if (latestQuery.isLoading) {
    return (
      <article
        className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center"
        data-testid="fx-chart-loading"
      >
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {pickByLocale(locale, S.fx.sectionTitle)}
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          {pickByLocale(locale, S.fx.loading)}
        </p>
      </article>
    );
  }

  const rates = latestQuery.data?.rates ?? [];
  const degraded = latestQuery.data?.degraded ?? false;

  if (rates.length === 0) {
    return (
      <article
        className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center"
        data-testid="fx-chart-empty"
      >
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {pickByLocale(locale, S.fx.sectionTitle)}
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          {pickByLocale(locale, degraded ? S.fx.feedWarming : S.fx.noRates)}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {pickByLocale(locale, S.fx.feedHint)}
        </p>
      </article>
    );
  }

  return (
    <article
      className="rounded-md border border-border bg-surface p-4"
      data-testid="fx-chart"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {pickByLocale(locale, S.fx.sectionTitle)}
        </div>
        {rates[0] ? (
          <span className="text-tiny text-neutral-400">
            {
              S.fx.updatedAt(
                new Date(rates[0].ts).toLocaleTimeString(bcp47For(locale)),
              )[locale]
            }
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rates.map((rate) => (
          <RateCard key={rate.pair} rate={rate} locale={locale} />
        ))}
      </div>
      <Sparkline
        points={historyQuery.data?.points ?? []}
        label={pickByLocale(locale, S.fx.sparklineLabel)}
      />
    </article>
  );
}

function RateCard({
  rate,
  locale,
}: {
  readonly rate: FxLatestRate;
  readonly locale: Locale;
}): JSX.Element {
  const label = PAIR_LABEL[rate.pair] ?? { en: rate.pair, sw: rate.pair, unit: '' };
  return (
    <div
      className="rounded-md border border-border bg-background p-3"
      data-testid={`fx-rate-${rate.pair}`}
    >
      <div className="text-tiny uppercase tracking-wide text-neutral-500">
        {label[locale]}
      </div>
      <div className="mt-1 font-display text-xl tabular-nums text-foreground">
        {formatRate(rate.rate, locale)}
      </div>
      <div className="mt-0.5 text-tiny text-neutral-400">
        {label.unit} · {rate.source}
      </div>
    </div>
  );
}

function Sparkline({
  points,
  label,
}: {
  readonly points: ReadonlyArray<FxHistoryPoint>;
  readonly label: string;
}): JSX.Element | null {
  const path = useMemo(() => buildSparklinePath(points), [points]);
  if (points.length === 0 || !path) return null;
  return (
    <div className="mt-4" data-testid="fx-sparkline">
      <div className="text-tiny uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <svg
        viewBox="0 0 200 40"
        className="mt-1 h-12 w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-signal-500"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function buildSparklinePath(
  points: ReadonlyArray<FxHistoryPoint>,
): string | null {
  if (points.length < 2) return null;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.rate);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const maxX = xs[xs.length - 1] ?? 1;
  const coords = points.map((p, i) => {
    const x = (i / maxX) * 200;
    const y = 40 - ((p.rate - minY) / range) * 36 - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M ${coords.join(' L ')}`;
}
