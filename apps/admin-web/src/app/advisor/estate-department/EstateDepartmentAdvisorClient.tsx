'use client';

/**
 * EstateDepartmentAdvisorClient — render the DepartmentHealthReport
 * returned by `/api/v1/advisor/estate-department`.
 *
 * Input is a snapshot keyed by tenantId. The advisor walks the
 * portfolio, ops, staffing, vendor, risk-insurance, regulatory, and
 * owner-relations axes and returns:
 *
 *   - `headline` — 3 veteran-director bullets
 *   - `sections` — each axis with its own recommendations
 *   - `topRecommendations` — top 5 across all sections, by composite
 */

import { useCallback, useState } from 'react';
import { z } from 'zod';
import { postAdvisor } from '../_lib/api';
import {
  AdvisorEmpty,
  AdvisorError,
  AdvisorLoading,
  FieldLabel,
} from '../_lib/states';

const recommendationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  headline: z.string(),
  rationale: z.string(),
  citation: z.string(),
  estimatedIrrPct: z.number().optional(),
  estimatedCostUsd: z.number().optional(),
  strategicScore: z.number(),
  urgencyScore: z.number(),
  composite: z.number(),
});

const healthSectionSchema = z.object({
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  recommendations: z.array(recommendationSchema),
});

const departmentReportSchema = z.object({
  tenantId: z.string(),
  generatedAtMs: z.number(),
  headline: z.array(z.string()),
  sections: z.array(healthSectionSchema),
  topRecommendations: z.array(recommendationSchema),
  narrative: z.string().optional(),
});

type DepartmentHealthReport = z.infer<typeof departmentReportSchema>;

const SEED = `{
  "tenantId": "tenant-001",
  "portfolio": {
    "doorsTotal": 480,
    "occupancyPct": 0.91,
    "delinquencyPct": 0.06
  },
  "ops": {
    "opexPerSfActual": 6.4,
    "opexPerSfPeerP50": 5.9
  }
}`;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: DepartmentHealthReport;
  readonly error?: string;
}

export function EstateDepartmentAdvisorClient(): JSX.Element {
  const [rawInput, setRawInput] = useState<string>(SEED);
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
      endpoint: 'estate-department',
      body: payload,
      schema: departmentReportSchema,
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="platform-card lg:col-span-1 self-start">
        <FieldLabel
          htmlFor="dept-input"
          label="Portfolio snapshot (JSON)"
          hint="The veteran-director composes the report from whatever subset of the snapshot you provide."
        >
          <textarea
            id="dept-input"
            rows={18}
            spellCheck={false}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            className="w-full font-mono text-xs bg-surface-sunken border border-border rounded-md p-3 text-foreground"
          />
        </FieldLabel>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === 'loading'}
          className="mt-3 w-full rounded-md bg-signal-500 px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Calling…' : 'Generate report'}
        </button>
      </section>

      <section className="lg:col-span-2 space-y-6">
        {state.status === 'idle' ? (
          <AdvisorEmpty
            title="Awaiting snapshot"
            hint="The advisor returns headline bullets, sectioned recommendations, and the top-N composite."
          />
        ) : null}
        {state.status === 'loading' ? <AdvisorLoading /> : null}
        {state.status === 'error' && state.error ? (
          <AdvisorError message={state.error} />
        ) : null}

        {state.status === 'ok' && state.data ? (
          <>
            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Headline
              </h3>
              <ul className="space-y-2">
                {state.data.headline.map((line, i) => (
                  <li key={i} className="text-sm text-foreground">
                    <span className="text-signal-500 mr-2" aria-hidden>
                      •
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              {state.data.narrative ? (
                <p className="text-sm text-neutral-400 mt-4">
                  {state.data.narrative}
                </p>
              ) : null}
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Top recommendations ({state.data.topRecommendations.length})
              </h3>
              <ol className="space-y-3">
                {state.data.topRecommendations.map((r) => (
                  <li
                    key={r.id}
                    className="border-l-2 border-signal-500 pl-3 text-sm"
                  >
                    <div className="flex items-baseline justify-between">
                      <div className="text-foreground font-medium">
                        {r.headline}
                      </div>
                      <span className="text-xs text-signal-500">
                        Composite {(r.composite * 100).toFixed(0)}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {r.rationale}
                    </div>
                    <div className="text-[0.7rem] text-neutral-500 mt-1">
                      {r.kind}
                      {typeof r.estimatedIrrPct === 'number'
                        ? ` · IRR ${(r.estimatedIrrPct * 100).toFixed(1)}%`
                        : ''}
                      {typeof r.estimatedCostUsd === 'number'
                        ? ` · cost $${r.estimatedCostUsd.toLocaleString()}`
                        : ''}
                    </div>
                    <div className="text-[0.7rem] text-neutral-500 italic mt-1">
                      {r.citation}
                    </div>
                  </li>
                ))}
              </ol>
            </article>

            {state.data.sections.map((section) => (
              <article key={section.kind} className="platform-card">
                <h3 className="text-sm font-medium text-neutral-300 mb-2">
                  {section.title}
                </h3>
                <p className="text-xs text-neutral-500 mb-3">
                  {section.summary}
                </p>
                {section.recommendations.length === 0 ? (
                  <p className="text-xs text-neutral-500 italic">
                    No active recommendations in this section.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {section.recommendations.map((r) => (
                      <li
                        key={r.id}
                        className="border-l-2 border-border pl-3"
                      >
                        <div className="text-foreground">{r.headline}</div>
                        <div className="text-xs text-neutral-400">
                          {r.rationale}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </>
        ) : null}
      </section>
    </div>
  );
}
