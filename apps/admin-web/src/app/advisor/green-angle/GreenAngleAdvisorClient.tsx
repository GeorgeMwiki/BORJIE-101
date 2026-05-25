'use client';

/**
 * GreenAngleAdvisorClient — free-text description → VeteranExpertReport.
 *
 * Renders:
 *
 *   - Top opportunities table (category × oneLiner × annual tCO2e × score)
 *   - Financing matches table (instrument × score × indicative terms)
 *   - Carbon-credit methodologies (registry × estimated tons/yr × $/t × lifetime value)
 *   - SDG-alignment radar (17 spokes, pure SVG so we don't pull a chart lib)
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

const greenAngleResponseSchema = z.object({
  profile: z
    .object({
      projectType: z.string(),
      jurisdiction: z.string(),
    })
    .partial()
    .passthrough(),
  opportunities: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      oneLiner: z.string(),
      score: z.number(),
      estimatedTCO2ePerYear: z.number(),
      sdgTargets: z.array(z.number()),
      references: z.array(z.string()),
    }),
  ),
  financing: z.array(
    z.object({
      instrument: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        sponsor: z.string(),
        indicativeTerms: z.string(),
      }),
      score: z.number(),
      rationale: z.string(),
      gatesToClear: z.array(z.string()),
    }),
  ),
  carbon: z.array(
    z.object({
      methodology: z.object({
        id: z.string(),
        registry: z.string(),
        title: z.string(),
      }),
      estimatedTCO2ePerYear: z.number(),
      creditingPeriodYears: z.number(),
      forwardValueUsdPerTon: z.number(),
      estimatedLifetimeValueUsd: z.number(),
    }),
  ),
  impact: z.object({
    sdgVector: z.array(z.number()),
    sdgCount: z.number(),
    coBenefitsScore: z.number(),
  }),
  narrative: z.string(),
});

type GreenAngleReport = z.infer<typeof greenAngleResponseSchema>;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: GreenAngleReport;
  readonly error?: string;
}

export function GreenAngleAdvisorClient(): JSX.Element {
  const [description, setDescription] = useState<string>(
    'A 12-storey mixed-use development in Dar es Salaam targeting residential + ground-floor retail, with rooftop PV, greywater reuse, and on-site EV charging.',
  );
  const [jurisdiction, setJurisdiction] = useState<string>('TZ');
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const submit = useCallback(async () => {
    if (description.trim().length < 30) {
      setState({
        status: 'error',
        error:
          'Project description should be at least 30 characters for a useful classifier match.',
      });
      return;
    }
    setState({ status: 'loading' });
    const envelope = await postAdvisor({
      endpoint: 'green-angle',
      body: {
        description: description.trim(),
        jurisdiction,
      },
      schema: greenAngleResponseSchema,
    });
    if (envelope.success && envelope.data) {
      setState({ status: 'ok', data: envelope.data });
    } else {
      setState({
        status: 'error',
        error: envelope.error ?? 'Unknown advisor error',
      });
    }
  }, [description, jurisdiction]);

  return (
    <div className="space-y-6">
      <section className="platform-card grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="md:col-span-2">
          <FieldLabel
            htmlFor="green-desc"
            label="Project description"
            hint="At least 30 characters. Mention the asset class, location, and any standout green features."
          >
            <textarea
              id="green-desc"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-sunken text-sm text-foreground px-3 py-2"
            />
          </FieldLabel>
        </div>
        <FieldLabel htmlFor="green-jur" label="Jurisdiction">
          <input
            id="green-jur"
            type="text"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value.toUpperCase())}
            maxLength={3}
            className="w-full rounded-md border border-border bg-surface-sunken text-sm text-foreground px-3 py-2"
          />
        </FieldLabel>
        <div className="md:col-span-3 flex justify-end">
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

      {state.status === 'idle' ? (
        <AdvisorEmpty
          title="Awaiting description"
          hint="Submit a project description to surface opportunities, financing matches, and carbon-credit methodologies."
        />
      ) : null}
      {state.status === 'loading' ? <AdvisorLoading /> : null}
      {state.status === 'error' && state.error ? (
        <AdvisorError message={state.error} />
      ) : null}

      {state.status === 'ok' && state.data ? (
        <GreenAngleReportView report={state.data} />
      ) : null}
    </div>
  );
}

function GreenAngleReportView({
  report,
}: {
  readonly report: GreenAngleReport;
}): JSX.Element {
  return (
    <div className="space-y-6">
      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">
          Executive summary
        </h3>
        <p className="text-sm text-neutral-300">{report.narrative}</p>
      </article>

      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          Ranked opportunities ({report.opportunities.length})
        </h3>
        {report.opportunities.length === 0 ? (
          <p className="text-sm text-neutral-500">No opportunities matched.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left py-2 pr-3">Title</th>
                  <th className="text-left py-2 pr-3">Category</th>
                  <th className="text-right py-2 pr-3">tCO₂e/yr</th>
                  <th className="text-right py-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {report.opportunities.slice(0, 10).map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <div className="text-foreground">{o.title}</div>
                      <div className="text-xs text-neutral-500">
                        {o.oneLiner}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-neutral-400">{o.category}</td>
                    <td className="py-2 pr-3 text-right text-neutral-300">
                      {o.estimatedTCO2ePerYear.toLocaleString()}
                    </td>
                    <td className="py-2 text-right text-signal-500">
                      {(o.score * 100).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          Financing matches ({report.financing.length})
        </h3>
        {report.financing.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No instruments matched. Try expanding the project description with
            sponsor type, ticket size, and tenor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left py-2 pr-3">Instrument</th>
                  <th className="text-left py-2 pr-3">Type</th>
                  <th className="text-left py-2 pr-3">Sponsor</th>
                  <th className="text-left py-2 pr-3">Indicative terms</th>
                  <th className="text-right py-2">Fit</th>
                </tr>
              </thead>
              <tbody>
                {report.financing.slice(0, 10).map((f) => (
                  <tr key={f.instrument.id} className="border-t border-border">
                    <td className="py-2 pr-3 text-foreground">
                      {f.instrument.name}
                    </td>
                    <td className="py-2 pr-3 text-neutral-400">
                      {f.instrument.type}
                    </td>
                    <td className="py-2 pr-3 text-neutral-400">
                      {f.instrument.sponsor}
                    </td>
                    <td className="py-2 pr-3 text-neutral-300">
                      {f.instrument.indicativeTerms}
                    </td>
                    <td className="py-2 text-right text-signal-500">
                      {(f.score * 100).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          Carbon-credit methodologies
        </h3>
        {report.carbon.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No registered methodologies matched.
          </p>
        ) : (
          <ul className="space-y-3">
            {report.carbon.map((c) => (
              <li key={c.methodology.id} className="border-l-2 border-success/40 pl-3">
                <div className="text-xs uppercase tracking-wider text-neutral-500">
                  {c.methodology.registry}
                </div>
                <div className="text-foreground">{c.methodology.title}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {c.estimatedTCO2ePerYear.toLocaleString()} tCO₂e/yr ·{' '}
                  {c.creditingPeriodYears}-yr crediting · $
                  {c.forwardValueUsdPerTon.toFixed(2)}/t · lifetime $
                  {c.estimatedLifetimeValueUsd.toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="platform-card">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          SDG alignment ({report.impact.sdgCount} of 17 served)
        </h3>
        <SdgRadar vector={report.impact.sdgVector} />
      </article>
    </div>
  );
}

/**
 * Pure-SVG 17-spoke radar. The 17 SDG axes are arranged around a
 * unit circle; the vector value (count of times an opportunity
 * serves that SDG) is normalised to the radial position.
 */
function SdgRadar({ vector }: { readonly vector: ReadonlyArray<number> }): JSX.Element {
  const padded = useMemo(() => {
    // eslint-disable-next-line security/detect-object-injection -- numeric loop counter 0..16, bounded indices
    const padded17 = Array.from({ length: 17 }, (_, i) => vector[i] ?? 0);
    const max = Math.max(1, ...padded17);
    return padded17.map((v) => v / max);
  }, [vector]);

  const SIZE = 280;
  const CENTER = SIZE / 2;
  const RADIUS = (SIZE / 2) - 30;
  const N = 17;

  const points = padded
    .map((v, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const x = CENTER + Math.cos(angle) * RADIUS * v;
      const y = CENTER + Math.sin(angle) * RADIUS * v;
      return `${x},${y}`;
    })
    .join(' ');

  const axisLines = Array.from({ length: N }, (_, i) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER + Math.cos(angle) * RADIUS;
    const y = CENTER + Math.sin(angle) * RADIUS;
    return { x, y, sdg: i + 1, angle };
  });

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label="SDG alignment radar"
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        fill="none"
        stroke="hsl(var(--border))"
        strokeOpacity={0.4}
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS * 0.5}
        fill="none"
        stroke="hsl(var(--border))"
        strokeOpacity={0.25}
      />
      {axisLines.map((a) => (
        <g key={a.sdg}>
          <line
            x1={CENTER}
            y1={CENTER}
            x2={a.x}
            y2={a.y}
            stroke="hsl(var(--border))"
            strokeOpacity={0.25}
          />
          <text
            x={CENTER + Math.cos(a.angle) * (RADIUS + 12)}
            y={CENTER + Math.sin(a.angle) * (RADIUS + 12)}
            fontSize={9}
            fill="hsl(var(--muted-foreground))"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {a.sdg}
          </text>
        </g>
      ))}
      <polygon
        points={points}
        fill="hsl(var(--signal-500) / 0.25)"
        stroke="hsl(var(--signal-500))"
        strokeWidth={1.5}
      />
    </svg>
  );
}
