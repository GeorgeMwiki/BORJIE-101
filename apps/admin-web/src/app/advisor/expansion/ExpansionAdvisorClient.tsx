'use client';

/**
 * ExpansionAdvisorClient — POSTs an ExpansionInputs payload to
 * `/api/v1/advisor/expansion` and renders:
 *
 *   - HBU gate log (4 tests: legal-permissibility, physical-possibility,
 *     financial-feasibility, maximal-productivity)
 *   - Capital-stack bar (tiers, weighted cost, DSCR, LTV)
 *   - Lease-up curve (SVG line over time)
 *
 * The form is JSON-input to keep parity with the other dense-input
 * advisors; the operator pastes the structured ExpansionInputs.
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

const expansionResponseSchema = z.object({
  parcelId: z.string(),
  recommendedUse: z
    .object({
      kind: z.string(),
    })
    .passthrough(),
  hbu: z.object({
    parcelId: z.string(),
    ranked: z.array(
      z.object({
        use: z.object({ kind: z.string() }).passthrough(),
        residualLandValue: z.number(),
        yieldOnCost: z.number(),
        irr: z.number(),
        npv: z.number(),
        productivityScore: z.number(),
      }),
    ),
    gateLog: z.array(
      z.object({
        gate: z.string(),
        passed: z.boolean(),
        notes: z.string().optional(),
      }),
    ),
  }),
  stack: z.object({
    tiers: z.array(
      z.object({
        tier: z.enum([
          'seniorDebt',
          'mezzanine',
          'preferredEquity',
          'commonEquity',
        ]),
        amount: z.number(),
        rate: z.number(),
      }),
    ),
    totalCost: z.number(),
    weightedCost: z.number(),
    dscr: z.number(),
    ltv: z.number(),
    yieldOnCost: z.number(),
  }),
  leaseUp: z.object({
    midpointMonths: z.number(),
    stabilisedVacancy: z.number(),
    points: z.array(
      z.object({ t: z.number(), occupied: z.number() }),
    ),
  }),
  narrative: z.string(),
  confidence: z.number(),
});

type ExpansionOpportunity = z.infer<typeof expansionResponseSchema>;

const SEED = `{
  "parcel": {
    "id": "parcel-001",
    "lat": -1.2667,
    "lng": 36.8167,
    "siteAreaSqm": 4200,
    "zoning": "MU-3",
    "far": 3.5,
    "maxHeightM": 35,
    "setbacksM": { "front": 4, "side": 3, "rear": 5 },
    "jurisdiction": "KE"
  },
  "candidates": [
    { "kind": "multifamily", "unitsTarget": 120 },
    { "kind": "mixed-use", "unitsTarget": 90 }
  ]
}`;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: ExpansionOpportunity;
  readonly error?: string;
}

const STACK_COLORS: Record<string, string> = {
  seniorDebt: 'bg-neutral-700',
  mezzanine: 'bg-warning',
  preferredEquity: 'bg-signal-500',
  commonEquity: 'bg-success',
};

export function ExpansionAdvisorClient(): JSX.Element {
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
      endpoint: 'expansion',
      body: payload,
      schema: expansionResponseSchema,
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
          htmlFor="exp-input"
          label="Expansion inputs (JSON)"
          hint="Pass a structured ExpansionInputs payload. See packages/expansion-advisor for the full shape."
        >
          <textarea
            id="exp-input"
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
          {state.status === 'loading' ? 'Calling…' : 'Run advisor'}
        </button>
      </section>

      <section className="lg:col-span-2 space-y-6">
        {state.status === 'idle' ? (
          <AdvisorEmpty
            title="Awaiting submission"
            hint="The advisor runs the 4-test HBU gauntlet, sizes the capital stack, and projects lease-up."
          />
        ) : null}
        {state.status === 'loading' ? <AdvisorLoading /> : null}
        {state.status === 'error' && state.error ? (
          <AdvisorError message={state.error} />
        ) : null}

        {state.status === 'ok' && state.data ? (
          <>
            <article className="platform-card">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-medium text-neutral-300">
                  HBU 4-test gate log
                </h3>
                <span className="text-xs text-neutral-500">
                  Confidence {(state.data.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <ul className="space-y-2">
                {state.data.hbu.gateLog.map((g, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span
                      className={`inline-block w-3 h-3 rounded-full ${g.passed ? 'bg-success' : 'bg-danger'}`}
                      aria-label={g.passed ? 'passed' : 'failed'}
                    />
                    <span className="text-foreground">{g.gate}</span>
                    {g.notes ? (
                      <span className="text-xs text-neutral-500">
                        {g.notes}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-neutral-300 mt-4">
                {state.data.narrative}
              </p>
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Capital stack
              </h3>
              <CapitalStackBar tiers={state.data.stack.tiers} />
              <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
                <Stat
                  label="Total cost"
                  value={`$${state.data.stack.totalCost.toLocaleString()}`}
                />
                <Stat
                  label="Wtd. cost"
                  value={`${(state.data.stack.weightedCost * 100).toFixed(2)}%`}
                />
                <Stat
                  label="DSCR"
                  value={state.data.stack.dscr.toFixed(2)}
                  tone={state.data.stack.dscr >= 1.25 ? 'positive' : 'warning'}
                />
                <Stat
                  label="LTV"
                  value={`${(state.data.stack.ltv * 100).toFixed(0)}%`}
                />
              </div>
            </article>

            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Lease-up curve · midpoint {state.data.leaseUp.midpointMonths} mo
              </h3>
              <LeaseUpChart
                points={state.data.leaseUp.points}
                stabilisedVacancy={state.data.leaseUp.stabilisedVacancy}
              />
            </article>
          </>
        ) : null}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'positive' | 'warning';
}): JSX.Element {
  const toneClass =
    tone === 'positive'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground';
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`text-lg font-display ${toneClass}`}>{value}</div>
    </div>
  );
}

function CapitalStackBar({
  tiers,
}: {
  readonly tiers: ReadonlyArray<{
    readonly tier: string;
    readonly amount: number;
    readonly rate: number;
  }>;
}): JSX.Element {
  const total = Math.max(
    1,
    tiers.reduce((s, t) => s + t.amount, 0),
  );
  return (
    <div>
      <div
        className="flex h-8 rounded-md overflow-hidden border border-border"
        role="img"
        aria-label="Capital stack composition"
      >
        {tiers.map((t) => {
          const pct = (t.amount / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={t.tier}
              className={`${STACK_COLORS[t.tier] ?? 'bg-neutral-600'} flex items-center justify-center`}
              style={{ width: `${pct}%` }}
              title={`${t.tier}: $${t.amount.toLocaleString()} @ ${(t.rate * 100).toFixed(2)}%`}
            >
              {pct > 12 ? (
                <span className="text-[0.62rem] uppercase tracking-wider text-white/90">
                  {t.tier}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {tiers.map((t) => (
          <li key={t.tier} className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${STACK_COLORS[t.tier] ?? 'bg-neutral-600'}`}
            />
            <span className="text-neutral-400">{t.tier}</span>
            <span className="text-neutral-300 ml-auto">
              ${t.amount.toLocaleString()} · {(t.rate * 100).toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeaseUpChart({
  points,
  stabilisedVacancy,
}: {
  readonly points: ReadonlyArray<{ readonly t: number; readonly occupied: number }>;
  readonly stabilisedVacancy: number;
}): JSX.Element {
  if (points.length < 2) {
    return (
      <p className="text-xs text-neutral-500">
        Insufficient curve points to render.
      </p>
    );
  }
  const W = 540;
  const H = 160;
  const PAD = 24;
  const maxT = Math.max(...points.map((p) => p.t));
  const xs = (t: number) => PAD + (t / Math.max(1, maxT)) * (W - 2 * PAD);
  const ys = (o: number) => H - PAD - o * (H - 2 * PAD);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.t).toFixed(1)} ${ys(p.occupied).toFixed(1)}`)
    .join(' ');
  const stabilisedOccupancy = 1 - stabilisedVacancy;
  const stabY = ys(stabilisedOccupancy);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={`Lease-up curve, stabilises at ${(stabilisedOccupancy * 100).toFixed(0)}%`}
    >
      <line
        x1={PAD}
        y1={H - PAD}
        x2={W - PAD}
        y2={H - PAD}
        stroke="hsl(var(--border))"
      />
      <line
        x1={PAD}
        y1={PAD}
        x2={PAD}
        y2={H - PAD}
        stroke="hsl(var(--border))"
      />
      <line
        x1={PAD}
        y1={stabY}
        x2={W - PAD}
        y2={stabY}
        stroke="hsl(var(--signal-500))"
        strokeOpacity={0.3}
        strokeDasharray="4 4"
      />
      <text
        x={W - PAD}
        y={stabY - 4}
        textAnchor="end"
        fontSize={10}
        fill="hsl(var(--signal-500))"
      >
        Stabilised {(stabilisedOccupancy * 100).toFixed(0)}%
      </text>
      <path d={path} fill="none" stroke="hsl(var(--signal-500))" strokeWidth={2} />
      <text x={PAD} y={H - 6} fontSize={10} fill="hsl(var(--muted-foreground))">
        Month 0
      </text>
      <text
        x={W - PAD}
        y={H - 6}
        textAnchor="end"
        fontSize={10}
        fill="hsl(var(--muted-foreground))"
      >
        Month {maxT}
      </text>
    </svg>
  );
}
