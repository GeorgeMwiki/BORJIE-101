import { cookies } from 'next/headers';
import { Empty } from '@borjie/design-system';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

interface ForecastPoint {
  readonly metric: string;
  readonly horizon: string;
  readonly pointEstimate: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly unit?: string;
}

/**
 * Degraded reasons are returned as a locale-NEUTRAL key + interpolation
 * payload so the rendering surface resolves the copy in the active locale
 * (zero-mix canon — the reason text never settles in English under a
 * Swahili shell).
 */
type DegradedReason =
  | { readonly key: 'offline' }
  | { readonly key: 'upstream'; readonly status: number }
  | { readonly key: 'unreachable' };

type ForecastsResult =
  | { readonly status: 'ok'; readonly forecasts: ReadonlyArray<ForecastPoint> }
  | { readonly status: 'degraded'; readonly reason: DegradedReason };

// Header + state copy resolved on the SERVER from the same cookie that seeds
// the client locale, so SSR and the first client paint render the SAME
// language (zero-mix canon — never an English header over a Swahili shell).
const COPY = {
  title: { en: 'Platform forecasts', sw: 'Utabiri wa jukwaa' },
  subtitle: {
    en: 'Sector forecasts with conformal intervals. Quarterly horizon, calibrated.',
    sw: 'Utabiri wa sekta wenye vipindi sambamba. Upeo wa robo mwaka, uliosawazishwa.',
  },
  degradedTitle: { en: 'Forecast service', sw: 'Huduma ya utabiri' },
  emptyTitle: { en: 'No forecasts ready', sw: 'Hakuna utabiri tayari' },
  emptyBody: {
    en: 'TGN service is healthy and the queue is empty — new forecasts will appear here.',
    sw: 'Huduma ya TGN ni nzima na foleni ni tupu — utabiri mpya utaonekana hapa.',
  },
  ci: { en: '90% CI', sw: 'Kipindi cha uhakika 90%' },
} as const;

const REASON_COPY = {
  offline: {
    en: 'Forecasting service offline (503). TGN inference unavailable.',
    sw: 'Huduma ya utabiri haipatikani (503). Ukokotoaji wa TGN haupatikani.',
  },
  unreachable: {
    en: 'Forecasting service unreachable. No mock intervals rendered.',
    sw: 'Huduma ya utabiri haifikiki. Hakuna vipindi bandia vilivyoonyeshwa.',
  },
  upstream: {
    en: (status: number) =>
      `Upstream returned ${status}. Retry when the forecasting service is healthy.`,
    sw: (status: number) =>
      `Huduma ya juu ilirudisha ${status}. Jaribu tena pindi huduma ya utabiri itakapokuwa nzima.`,
  },
} as const;

function renderReason(locale: Locale, reason: DegradedReason): string {
  if (reason.key === 'upstream') {
    return pickByLocale(locale, REASON_COPY.upstream)(reason.status);
  }
  return pickByLocale(locale, REASON_COPY[reason.key]);
}

async function fetchForecasts(cookieHeader: string): Promise<ForecastsResult> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/forecasts`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return { status: 'degraded', reason: { key: 'offline' } };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: { key: 'upstream', status: res.status },
      };
    }
    const data = (await res.json()) as { forecasts: ReadonlyArray<ForecastPoint> };
    return { status: 'ok', forecasts: data.forecasts };
  } catch {
    return { status: 'degraded', reason: { key: 'unreachable' } };
  }
}

export default async function ForecastsPage() {
  const locale = await readLocaleFromServerCookies();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const result = await fetchForecasts(cookieHeader);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-display text-foreground mb-1">
          {pickByLocale(locale, COPY.title)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, COPY.subtitle)}
        </p>
      </header>

      {result.status === 'degraded' ? (
        <DegradedCard
          title={pickByLocale(locale, COPY.degradedTitle)}
          reason={renderReason(locale, result.reason)}
        />
      ) : result.forecasts.length === 0 ? (
        <Empty
          title={pickByLocale(locale, COPY.emptyTitle)}
          description={pickByLocale(locale, COPY.emptyBody)}
        />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {result.forecasts.map((fc) => (
            <li key={`${fc.metric}-${fc.horizon}`} className="platform-card">
              <div className="platform-card-title">
                {fc.metric} · {fc.horizon}
              </div>
              <div className="platform-card-value">
                {fc.pointEstimate.toFixed(2)}
                {fc.unit ? (
                  <span className="ml-1 text-base text-muted-foreground">
                    {fc.unit}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {pickByLocale(locale, COPY.ci)}: [{fc.intervalLow.toFixed(2)},{' '}
                {fc.intervalHigh.toFixed(2)}]
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
