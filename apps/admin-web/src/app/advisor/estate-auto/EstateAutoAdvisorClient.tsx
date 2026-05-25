'use client';

/**
 * EstateAutoAdvisorClient — fetches `/api/v1/advisor/estate-auto` and
 * renders three operational panels:
 *
 *   - Predictive-maintenance matrix — health-score × P(fail in N days),
 *     rendered as a quadrant grid (rows = verdict band, cols = horizon)
 *   - Collection cadence — escalation steps over offset days
 *   - Vendor scorecard — top vendors ranked by composite score
 *
 * The endpoint is a `GET` (not `POST`) because it scopes to the
 * caller's tenant via the session cookie — no body is needed.
 */

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { AdvisorEmpty, AdvisorError, AdvisorLoading } from '../_lib/states';

const failureForecastSchema = z.object({
  assetId: z.string(),
  family: z.string(),
  score: z.number(),
  probabilityWithin: z.object({
    d7: z.number(),
    d30: z.number(),
    d90: z.number(),
  }),
  verdict: z.enum(['healthy', 'monitor', 'service', 'urgent']),
});

const escalationStepSchema = z.object({
  atDayFromDue: z.number(),
  stage: z.enum([
    'soft-reminder',
    'firm-reminder',
    'notice-to-cure',
    'eviction-prep',
  ]),
  message: z.string(),
});

const vendorScoreSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string().optional(),
  priceScore: z.number(),
  responseScore: z.number(),
  qualityScore: z.number(),
  proximityScore: z.number(),
  complianceScore: z.number(),
  total: z.number(),
});

const estateAutoResponseSchema = z.object({
  forecasts: z.array(failureForecastSchema),
  collectionCadence: z.array(escalationStepSchema),
  vendorScorecard: z.array(vendorScoreSchema),
});

type EstateAutoReport = z.infer<typeof estateAutoResponseSchema>;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: EstateAutoReport;
  readonly error?: string;
}

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost'
  ) {
    return 'http://localhost:4000/api/v1';
  }
  return '/api/v1';
}

export function EstateAutoAdvisorClient(): JSX.Element {
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const fetchDashboard = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${getApiBase()}/advisor/estate-auto`, {
        credentials: 'include',
      });
      const json: { data?: unknown; error?: { message?: string } } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setState({
          status: 'error',
          error:
            json.error?.message ?? `Upstream returned HTTP ${res.status}`,
        });
        return;
      }
      const parsed = estateAutoResponseSchema.safeParse(json.data ?? json);
      if (!parsed.success) {
        setState({
          status: 'error',
          error: `Advisor response did not match contract: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => i.message)
            .join('; ')}`,
        });
        return;
      }
      setState({ status: 'ok', data: parsed.data });
    } catch (error) {
      console.error('estate-auto fetch failed:', error);
      setState({ status: 'error', error: 'Network error reaching api-gateway' });
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void fetchDashboard()}
          disabled={state.status === 'loading'}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-surface disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {state.status === 'idle' || state.status === 'loading' ? (
        <AdvisorLoading label="Pulling estate-automation dashboard…" />
      ) : null}
      {state.status === 'error' && state.error ? (
        <AdvisorError message={state.error} />
      ) : null}

      {state.status === 'ok' && state.data ? (
        <>
          <PredictiveMaintenancePanel forecasts={state.data.forecasts} />
          <CollectionCadencePanel cadence={state.data.collectionCadence} />
          <VendorScorecardPanel scorecard={state.data.vendorScorecard} />
        </>
      ) : null}
    </div>
  );
}

function PredictiveMaintenancePanel({
  forecasts,
}: {
  readonly forecasts: ReadonlyArray<{
    readonly assetId: string;
    readonly family: string;
    readonly score: number;
    readonly probabilityWithin: {
      readonly d7: number;
      readonly d30: number;
      readonly d90: number;
    };
    readonly verdict: 'healthy' | 'monitor' | 'service' | 'urgent';
  }>;
}): JSX.Element {
  if (forecasts.length === 0) {
    return (
      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          Predictive maintenance
        </h3>
        <AdvisorEmpty
          title="No assets reporting"
          hint="No telemetry-bearing assets are currently registered for this tenant."
        />
      </article>
    );
  }
  return (
    <article className="platform-card">
      <h3 className="text-sm font-medium text-neutral-300 mb-3">
        Predictive maintenance ({forecasts.length} assets)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="text-left py-2 pr-3">Asset</th>
              <th className="text-left py-2 pr-3">Family</th>
              <th className="text-right py-2 pr-3">Health</th>
              <th className="text-right py-2 pr-3">P(fail 7d)</th>
              <th className="text-right py-2 pr-3">P(fail 30d)</th>
              <th className="text-right py-2 pr-3">P(fail 90d)</th>
              <th className="text-left py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {forecasts.map((f) => (
              <tr key={f.assetId} className="border-t border-border">
                <td className="py-2 pr-3 text-foreground">{f.assetId}</td>
                <td className="py-2 pr-3 text-neutral-400">{f.family}</td>
                <td className="py-2 pr-3 text-right">
                  <HealthCell score={f.score} />
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {(f.probabilityWithin.d7 * 100).toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {(f.probabilityWithin.d30 * 100).toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {(f.probabilityWithin.d90 * 100).toFixed(1)}%
                </td>
                <td className="py-2">
                  <VerdictPill verdict={f.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function HealthCell({ score }: { readonly score: number }): JSX.Element {
  // Higher score = worse health per estate-auto types.
  const pct = Math.min(100, Math.max(0, score * 100));
  const tone =
    score >= 0.75 ? 'bg-danger' : score >= 0.5 ? 'bg-warning' : 'bg-success';
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-neutral-400">{score.toFixed(2)}</span>
    </div>
  );
}

function VerdictPill({
  verdict,
}: {
  readonly verdict: 'healthy' | 'monitor' | 'service' | 'urgent';
}): JSX.Element {
  // eslint-disable-next-line security/detect-object-injection -- compile-time literal object with TS-narrowed key
  const tone = {
    healthy: 'border-success/40 text-success',
    monitor: 'border-signal-500/40 text-signal-500',
    service: 'border-warning/40 text-warning',
    urgent: 'border-danger/40 text-danger',
  }[verdict];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.62rem] uppercase tracking-wider ${tone}`}
    >
      {verdict}
    </span>
  );
}

function CollectionCadencePanel({
  cadence,
}: {
  readonly cadence: ReadonlyArray<{
    readonly atDayFromDue: number;
    readonly stage: string;
    readonly message: string;
  }>;
}): JSX.Element {
  if (cadence.length === 0) return <></>;
  return (
    <article className="platform-card">
      <h3 className="text-sm font-medium text-neutral-300 mb-3">
        Collection cadence
      </h3>
      <ol className="relative border-l-2 border-border pl-6 space-y-4">
        {cadence.map((step, i) => (
          <li key={i} className="relative">
            <span
              className="absolute -left-[1.85rem] top-1 w-3 h-3 rounded-full bg-signal-500"
              aria-hidden
            />
            <div className="text-xs uppercase tracking-wider text-neutral-500">
              Day {step.atDayFromDue} · {step.stage}
            </div>
            <div className="text-sm text-foreground">{step.message}</div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function VendorScorecardPanel({
  scorecard,
}: {
  readonly scorecard: ReadonlyArray<{
    readonly vendorId: string;
    readonly vendorName?: string;
    readonly priceScore: number;
    readonly responseScore: number;
    readonly qualityScore: number;
    readonly proximityScore: number;
    readonly complianceScore: number;
    readonly total: number;
  }>;
}): JSX.Element {
  if (scorecard.length === 0) return <></>;
  return (
    <article className="platform-card">
      <h3 className="text-sm font-medium text-neutral-300 mb-3">
        Vendor scorecard
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="text-left py-2 pr-3">Vendor</th>
              <th className="text-right py-2 pr-3">Price</th>
              <th className="text-right py-2 pr-3">Response</th>
              <th className="text-right py-2 pr-3">Quality</th>
              <th className="text-right py-2 pr-3">Proximity</th>
              <th className="text-right py-2 pr-3">Compliance</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.map((v) => (
              <tr key={v.vendorId} className="border-t border-border">
                <td className="py-2 pr-3 text-foreground">
                  {v.vendorName ?? v.vendorId}
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {v.priceScore.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {v.responseScore.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {v.qualityScore.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {v.proximityScore.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-right text-neutral-300">
                  {v.complianceScore.toFixed(2)}
                </td>
                <td className="py-2 text-right text-signal-500 font-medium">
                  {v.total.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
