import { cookies } from 'next/headers';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';

interface ForecastPoint {
  readonly metric: string;
  readonly horizon: string;
  readonly pointEstimate: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly unit?: string;
}

type ForecastsResult =
  | { readonly status: 'ok'; readonly forecasts: ReadonlyArray<ForecastPoint> }
  | { readonly status: 'degraded'; readonly reason: string };

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
      return {
        status: 'degraded',
        reason: 'Forecasting service offline (503). TGN inference unavailable.',
      };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: `Upstream returned ${res.status}. Retry when the forecasting service is healthy.`,
      };
    }
    const data = (await res.json()) as { forecasts: ReadonlyArray<ForecastPoint> };
    return { status: 'ok', forecasts: data.forecasts };
  } catch (error) {
    console.error('Forecasts fetch failed:', error);
    return {
      status: 'degraded',
      reason: 'Forecasting service unreachable. No mock intervals rendered.',
    };
  }
}

export default async function ForecastsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const result = await fetchForecasts(cookieHeader);

  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main className="flex-1 p-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-foreground mb-1">
              Platform forecasts
            </h1>
            <p className="text-sm text-neutral-400">
              Sector forecasts with conformal intervals. Quarterly horizon, calibrated.
            </p>
          </div>
          <StaffIdentityStrip />
        </header>

        {result.status === 'degraded' ? (
          <DegradedCard title="Forecast service" reason={result.reason} />
        ) : result.forecasts.length === 0 ? (
          <div className="platform-card">
            <div className="text-sm text-neutral-400">
              No forecasts ready. TGN service healthy, queue empty.
            </div>
          </div>
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
                    <span className="text-base text-neutral-500 ml-1">
                      {fc.unit}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-500 mt-2">
                  90% CI: [{fc.intervalLow.toFixed(2)}, {fc.intervalHigh.toFixed(2)}]
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
