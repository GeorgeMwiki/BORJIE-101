'use client';

/**
 * AcquisitionAdvisorClient — interactive form + report renderer.
 *
 * Posts `{ deal, findings }` to `/api/v1/advisor/acquisition` and renders
 * the returned `AcquisitionRecommendation` as a verdict card, pricing
 * grid, critical-findings list, and a closing checklist.
 *
 * The form is intentionally minimal — operators paste a JSON
 * DealSnapshot and DD-finding array. A guided wizard is out of scope;
 * the goal here is to surface the advisor output, not become the data
 * entry tool. (Full wizards live in the LOI/PSA studio.)
 */

import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { postAdvisor } from '../_lib/api';
import { AdvisorEmpty, AdvisorError, AdvisorLoading } from '../_lib/states';

const acquisitionResponseSchema = z.object({
  dealId: z.string(),
  verdict: z.enum(['go', 'proceed-with-conditions', 'renegotiate', 'no-go']),
  composite: z.number(),
  pricingRecommendation: z.object({
    compTriangulatedValue: z.number(),
    incomeCapValue: z.number(),
    replacementCostValue: z.number(),
    blendedRecommendedOffer: z.number(),
    walkAwayCeiling: z.number(),
  }),
  findings: z.array(
    z.object({
      id: z.string(),
      domain: z.string(),
      severity: z.enum(['info', 'warn', 'critical', 'deal-killer']),
      summary: z.string(),
      detail: z.string(),
      mustCureBeforeClose: z.boolean(),
      estimatedCureCostUsd: z.number().optional(),
    }),
  ),
  closingChecklist: z.array(z.string()),
  narrative: z.string(),
  confidence: z.number(),
});

type AcquisitionRecommendation = z.infer<typeof acquisitionResponseSchema>;

const SEED_INPUT = `{
  "deal": {
    "id": "DEAL-EXAMPLE-001",
    "subMarket": "Westlands",
    "jurisdiction": "KE",
    "assetClass": "multifamily",
    "askingPrice": 4500000,
    "currency": "USD",
    "nlaSqm": 1850,
    "siteAreaSqm": 1200,
    "lat": -1.2667,
    "lng": 36.8167
  },
  "findings": []
}`;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: AcquisitionRecommendation;
  readonly error?: string;
}

function verdictTone(
  verdict: AcquisitionRecommendation['verdict'],
): 'positive' | 'caution' | 'warning' | 'danger' {
  switch (verdict) {
    case 'go':
      return 'positive';
    case 'proceed-with-conditions':
      return 'caution';
    case 'renegotiate':
      return 'warning';
    case 'no-go':
      return 'danger';
  }
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function AcquisitionAdvisorClient(): JSX.Element {
  const [rawInput, setRawInput] = useState<string>(SEED_INPUT);
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const submit = useCallback(async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawInput);
    } catch (e) {
      setState({
        status: 'error',
        error: `Input is not valid JSON: ${(e as Error).message}`,
      });
      return;
    }
    setState({ status: 'loading' });
    const envelope = await postAdvisor({
      endpoint: 'acquisition',
      body: payload,
      schema: acquisitionResponseSchema,
    });
    if (envelope.success && envelope.data) {
      setState({ status: 'ok', data: envelope.data });
    } else {
      setState({
        status: 'error',
        error: envelope.error ?? 'Unknown advisor error',
      });
    }
  }, [rawInput]);

  const criticalFindings = useMemo(
    () =>
      state.data
        ? state.data.findings.filter(
            (f) => f.severity === 'critical' || f.severity === 'deal-killer',
          )
        : [],
    [state.data],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="platform-card" aria-labelledby="acq-input-heading">
        <h2
          id="acq-input-heading"
          className="text-sm font-medium text-neutral-300 mb-2"
        >
          Deal snapshot + DD findings
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Paste a JSON object with `deal` and `findings` keys. The advisor
          composes the verdict over MCDA weights documented in
          packages/acquisition-advisor.
        </p>
        <label htmlFor="acq-input" className="sr-only">
          Acquisition advisor JSON input
        </label>
        <textarea
          id="acq-input"
          spellCheck={false}
          rows={18}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          className="w-full font-mono text-xs bg-surface-sunken border border-border rounded-md p-3 text-foreground"
        />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-neutral-500">
            POST → /api/v1/advisor/acquisition
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state.status === 'loading'}
            className="rounded-md bg-signal-500 px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-60"
          >
            {state.status === 'loading' ? 'Calling…' : 'Run advisor'}
          </button>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="acq-output-heading">
        <h2 id="acq-output-heading" className="sr-only">
          Acquisition recommendation
        </h2>

        {state.status === 'idle' ? (
          <AdvisorEmpty
            title="Awaiting submission"
            hint="Submit a deal snapshot to render the verdict, pricing triangulation, critical findings, and closing checklist."
          />
        ) : null}
        {state.status === 'loading' ? <AdvisorLoading /> : null}
        {state.status === 'error' && state.error ? (
          <AdvisorError message={state.error} />
        ) : null}

        {state.status === 'ok' && state.data ? (
          <>
            <article
              className="platform-card"
              aria-label={`Verdict for deal ${state.data.dealId}`}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-neutral-500">
                  Verdict
                </span>
                <span className="text-xs text-neutral-500">
                  Composite {(state.data.composite * 100).toFixed(1)} · Confidence{' '}
                  {(state.data.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <VerdictBadge
                verdict={state.data.verdict}
                tone={verdictTone(state.data.verdict)}
              />
              <p className="mt-3 text-sm text-neutral-300">
                {state.data.narrative}
              </p>
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Pricing recommendation
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <PricingRow
                  label="Comp-triangulated"
                  value={state.data.pricingRecommendation.compTriangulatedValue}
                />
                <PricingRow
                  label="Income-cap"
                  value={state.data.pricingRecommendation.incomeCapValue}
                />
                <PricingRow
                  label="Replacement-cost"
                  value={state.data.pricingRecommendation.replacementCostValue}
                />
                <PricingRow
                  label="Blended offer"
                  value={
                    state.data.pricingRecommendation.blendedRecommendedOffer
                  }
                  emphasis
                />
                <PricingRow
                  label="Walk-away ceiling"
                  value={state.data.pricingRecommendation.walkAwayCeiling}
                  tone="warning"
                />
              </dl>
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Critical findings ({criticalFindings.length})
              </h3>
              {criticalFindings.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No critical or deal-killer findings flagged.
                </p>
              ) : (
                <ul className="space-y-2">
                  {criticalFindings.map((f) => (
                    <li
                      key={f.id}
                      className="border-l-2 border-warning pl-3 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-wider text-warning">
                          {f.severity}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {f.domain}
                        </span>
                        {f.mustCureBeforeClose ? (
                          <span className="text-[0.62rem] uppercase tracking-wider rounded-full border border-warning/40 px-1.5 py-0.5 text-warning">
                            must cure before close
                          </span>
                        ) : null}
                      </div>
                      <div className="text-foreground">{f.summary}</div>
                      <div className="text-xs text-neutral-400">{f.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Closing checklist
              </h3>
              {state.data.closingChecklist.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No closing items returned.
                </p>
              ) : (
                <ol className="space-y-1 text-sm list-decimal pl-5">
                  {state.data.closingChecklist.map((step, i) => (
                    <li key={i} className="text-neutral-300">
                      {step}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          </>
        ) : null}
      </section>
    </div>
  );
}

function VerdictBadge({
  verdict,
  tone,
}: {
  readonly verdict: AcquisitionRecommendation['verdict'];
  readonly tone: 'positive' | 'caution' | 'warning' | 'danger';
}): JSX.Element {
  // eslint-disable-next-line security/detect-object-injection -- compile-time literal object with TS-narrowed key
  const toneClass = {
    positive: 'border-success/40 text-success',
    caution: 'border-signal-500/40 text-signal-500',
    warning: 'border-warning/40 text-warning',
    danger: 'border-danger/40 text-danger',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium ${toneClass}`}
    >
      {verdict.replace(/-/g, ' ')}
    </span>
  );
}

function PricingRow({
  label,
  value,
  emphasis,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasis?: boolean;
  readonly tone?: 'warning';
}): JSX.Element {
  return (
    <>
      <dt className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd
        className={`text-right ${emphasis ? 'text-signal-500 font-medium' : tone === 'warning' ? 'text-warning' : 'text-foreground'}`}
      >
        {formatUsd(value)}
      </dd>
    </>
  );
}
