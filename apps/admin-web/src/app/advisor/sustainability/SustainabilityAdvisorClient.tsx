'use client';

/**
 * SustainabilityAdvisorClient — render the ESG report for a single
 * property. The endpoint accepts a property identifier and returns an
 * aggregate that we render as:
 *
 *   - GHG Scope 1 / 2 / 3 horizontal bars (proportional to total)
 *   - Predicted rating cards (BREEAM, LEED, EDGE)
 *   - BNG units delivered
 *   - Carbon-credit forward value (USD/yr)
 *
 * The bars are pure SVG-via-CSS so we don't have to import a chart
 * library just for three rectangles. Visual proportion only — the
 * numeric scope totals are always rendered as text alongside.
 */

import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { postAdvisor } from '../_lib/api';
import {
  AdvisorEmpty,
  AdvisorError,
  AdvisorLoading,
  FieldLabel,
} from '../_lib/states';

const greenRatingSchema = z.object({
  scheme: z.enum(['BREEAM', 'LEED', 'GreenStar', 'EDGE', 'CASBEE', 'DGNB', 'EPC']),
  version: z.string(),
  totalScore: z.number(),
  maxScore: z.number(),
  percent: z.number(),
  estimatedBand: z.string(),
  confidence: z.enum(['stub', 'low', 'medium', 'high']),
});

const sustainabilityResponseSchema = z.object({
  propertyId: z.string(),
  carbon: z.object({
    scope1KgCO2e: z.number(),
    scope2KgCO2e: z.number(),
    scope3KgCO2e: z.number(),
    totalKgCO2e: z.number(),
    intensityKgCO2ePerM2: z.number().optional(),
  }),
  ratings: z.array(greenRatingSchema),
  bng: z
    .object({
      unitsDelivered: z.number(),
      unitsRequired: z.number(),
    })
    .nullable()
    .optional(),
  carbonCredit: z
    .object({
      forwardValueUsdPerTon: z.number(),
      estimatedAnnualVolumeTons: z.number(),
      annualValueUsd: z.number(),
    })
    .nullable()
    .optional(),
});

type SustainabilityReport = z.infer<typeof sustainabilityResponseSchema>;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: SustainabilityReport;
  readonly error?: string;
}

export function SustainabilityAdvisorClient(): JSX.Element {
  const [propertyId, setPropertyId] = useState<string>('property-001');
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const submit = useCallback(async () => {
    if (!propertyId.trim()) {
      setState({ status: 'error', error: 'Property ID is required.' });
      return;
    }
    setState({ status: 'loading' });
    const envelope = await postAdvisor({
      endpoint: 'sustainability',
      body: { propertyId: propertyId.trim() },
      schema: sustainabilityResponseSchema,
    });
    if (envelope.success && envelope.data) {
      setState({ status: 'ok', data: envelope.data });
    } else {
      setState({
        status: 'error',
        error: envelope.error ?? 'Unknown advisor error',
      });
    }
  }, [propertyId]);

  return (
    <div className="space-y-6">
      <section className="platform-card grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <FieldLabel htmlFor="sust-property" label="Property ID">
          <input
            id="sust-property"
            type="text"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            placeholder="property-001"
            className="w-full rounded-md border border-border bg-surface-sunken text-sm text-foreground px-3 py-2"
          />
        </FieldLabel>
        <div />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === 'loading'}
          className="rounded-md bg-signal-500 px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Calling…' : 'Generate report'}
        </button>
      </section>

      {state.status === 'idle' ? (
        <AdvisorEmpty
          title="Awaiting selection"
          hint="Enter a property ID to render the ESG report."
        />
      ) : null}
      {state.status === 'loading' ? <AdvisorLoading /> : null}
      {state.status === 'error' && state.error ? (
        <AdvisorError message={state.error} />
      ) : null}

      {state.status === 'ok' && state.data ? (
        <SustainabilityReportView report={state.data} />
      ) : null}
    </div>
  );
}

function SustainabilityReportView({
  report,
}: {
  readonly report: SustainabilityReport;
}): JSX.Element {
  const scopes = useMemo(() => {
    const total = Math.max(
      1,
      report.carbon.scope1KgCO2e +
        report.carbon.scope2KgCO2e +
        report.carbon.scope3KgCO2e,
    );
    return [
      {
        label: 'Scope 1',
        value: report.carbon.scope1KgCO2e,
        pct: (report.carbon.scope1KgCO2e / total) * 100,
        colorClass: 'bg-danger',
      },
      {
        label: 'Scope 2',
        value: report.carbon.scope2KgCO2e,
        pct: (report.carbon.scope2KgCO2e / total) * 100,
        colorClass: 'bg-warning',
      },
      {
        label: 'Scope 3',
        value: report.carbon.scope3KgCO2e,
        pct: (report.carbon.scope3KgCO2e / total) * 100,
        colorClass: 'bg-signal-500',
      },
    ];
  }, [report]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <article className="platform-card" aria-labelledby="sust-ghg-heading">
        <div className="flex items-baseline justify-between mb-3">
          <h3
            id="sust-ghg-heading"
            className="text-sm font-medium text-neutral-300"
          >
            GHG Protocol — Scope 1 / 2 / 3
          </h3>
          <span className="text-xs text-neutral-500">
            Total {Math.round(report.carbon.totalKgCO2e).toLocaleString()} kgCO₂e
          </span>
        </div>
        <ul className="space-y-3">
          {scopes.map((s) => (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="text-neutral-400">{s.label}</span>
                <span className="text-neutral-300">
                  {Math.round(s.value).toLocaleString()} kgCO₂e ·{' '}
                  {s.pct.toFixed(1)}%
                </span>
              </div>
              <div
                className="h-2 rounded-full bg-surface-sunken overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s.pct)}
                aria-label={`${s.label} share`}
              >
                <div
                  className={`h-full ${s.colorClass}`}
                  style={{ width: `${Math.min(100, s.pct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        {typeof report.carbon.intensityKgCO2ePerM2 === 'number' ? (
          <div className="mt-4 text-xs text-neutral-500">
            Intensity{' '}
            <span className="text-neutral-300">
              {report.carbon.intensityKgCO2ePerM2.toFixed(1)} kgCO₂e/m²
            </span>
          </div>
        ) : null}
      </article>

      <article className="platform-card" aria-labelledby="sust-ratings-heading">
        <h3
          id="sust-ratings-heading"
          className="text-sm font-medium text-neutral-300 mb-3"
        >
          Predicted rating
        </h3>
        {report.ratings.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No ratings returned — inputs may be too sparse for a band estimate.
          </p>
        ) : (
          <ul className="space-y-3">
            {report.ratings.map((r) => (
              <li
                key={`${r.scheme}-${r.version}`}
                className="flex items-baseline justify-between"
              >
                <div>
                  <div className="text-xs uppercase tracking-wider text-neutral-500">
                    {r.scheme} {r.version}
                  </div>
                  <div className="text-lg font-display text-foreground">
                    {r.estimatedBand}
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-400">
                  <div>{r.percent.toFixed(0)}%</div>
                  <div className="uppercase tracking-wider">
                    conf · {r.confidence}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      {report.bng ? (
        <article className="platform-card" aria-labelledby="sust-bng-heading">
          <h3
            id="sust-bng-heading"
            className="text-sm font-medium text-neutral-300 mb-3"
          >
            Biodiversity Net Gain
          </h3>
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Delivered
              </div>
              <div className="text-2xl font-display text-foreground">
                {report.bng.unitsDelivered.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Required
              </div>
              <div className="text-2xl font-display text-foreground">
                {report.bng.unitsRequired.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Gap
              </div>
              <div
                className={`text-2xl font-display ${
                  report.bng.unitsDelivered >= report.bng.unitsRequired
                    ? 'text-success'
                    : 'text-warning'
                }`}
              >
                {(report.bng.unitsDelivered - report.bng.unitsRequired).toFixed(
                  1,
                )}
              </div>
            </div>
          </div>
        </article>
      ) : null}

      {report.carbonCredit ? (
        <article
          className="platform-card"
          aria-labelledby="sust-credit-heading"
        >
          <h3
            id="sust-credit-heading"
            className="text-sm font-medium text-neutral-300 mb-3"
          >
            Carbon-credit value
          </h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Volume / yr
              </div>
              <div className="text-foreground">
                {report.carbonCredit.estimatedAnnualVolumeTons.toLocaleString()}{' '}
                tCO₂e
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Forward $/t
              </div>
              <div className="text-foreground">
                ${report.carbonCredit.forwardValueUsdPerTon.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Annual value
              </div>
              <div className="text-signal-500 font-medium">
                ${report.carbonCredit.annualValueUsd.toLocaleString()}
              </div>
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}
