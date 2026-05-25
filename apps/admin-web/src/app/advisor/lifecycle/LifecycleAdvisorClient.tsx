'use client';

/**
 * LifecycleAdvisorClient — pick an asset + stage and render the
 * orchestrator output. The advisor returns:
 *
 *   - `nextBestAction` — single DomainRecommendation with the highest
 *     composite of priority + confidence
 *   - `recommendations` — every alternative DomainRecommendation, used
 *     to render the "alternatives" list
 *
 * Citations come back as a `readonly string[]`. We show every citation
 * because the operator needs them for the IC memo.
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

const LIFECYCLE_STAGES = [
  'pre-development',
  'under-construction',
  'lease-up',
  'stabilised-hold',
  'refi-window',
  'disposition-window',
] as const;

const domainRecommendationSchema = z.object({
  domain: z.enum([
    'development',
    'disposition',
    'refinancing',
    'investor-relations',
  ]),
  action: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  confidence: z.number(),
  rationale: z.string(),
  citations: z.array(z.string()),
});

const lifecycleResponseSchema = z.object({
  assetId: z.string(),
  stage: z.enum(LIFECYCLE_STAGES),
  recommendations: z.array(domainRecommendationSchema),
  nextBestAction: domainRecommendationSchema,
});

type LifecycleAdvisorOutput = z.infer<typeof lifecycleResponseSchema>;
type DomainRecommendation = z.infer<typeof domainRecommendationSchema>;

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: LifecycleAdvisorOutput;
  readonly error?: string;
}

function priorityTone(p: DomainRecommendation['priority']): string {
  switch (p) {
    case 'critical':
      return 'border-danger/40 text-danger';
    case 'high':
      return 'border-warning/40 text-warning';
    case 'medium':
      return 'border-signal-500/40 text-signal-500';
    case 'low':
      return 'border-border text-neutral-400';
  }
}

export function LifecycleAdvisorClient(): JSX.Element {
  const [assetId, setAssetId] = useState<string>('asset-001');
  const [stage, setStage] =
    useState<(typeof LIFECYCLE_STAGES)[number]>('stabilised-hold');
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const submit = useCallback(async () => {
    if (!assetId.trim()) {
      setState({ status: 'error', error: 'Asset ID is required.' });
      return;
    }
    setState({ status: 'loading' });
    const envelope = await postAdvisor({
      endpoint: 'lifecycle',
      body: { assetId: assetId.trim(), stage },
      schema: lifecycleResponseSchema,
    });
    if (envelope.success && envelope.data) {
      setState({ status: 'ok', data: envelope.data });
    } else {
      setState({
        status: 'error',
        error: envelope.error ?? 'Unknown advisor error',
      });
    }
  }, [assetId, stage]);

  return (
    <div className="space-y-6">
      <section
        className="platform-card grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
        aria-labelledby="life-input-heading"
      >
        <h2 id="life-input-heading" className="sr-only">
          Asset + stage selector
        </h2>
        <FieldLabel htmlFor="life-asset" label="Asset ID">
          <input
            id="life-asset"
            type="text"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            placeholder="asset-001"
            className="w-full rounded-md border border-border bg-surface-sunken text-sm text-foreground px-3 py-2"
          />
        </FieldLabel>
        <FieldLabel htmlFor="life-stage" label="Lifecycle stage">
          <select
            id="life-stage"
            value={stage}
            onChange={(e) =>
              setStage(e.target.value as (typeof LIFECYCLE_STAGES)[number])
            }
            className="w-full rounded-md border border-border bg-surface-sunken text-sm text-foreground px-3 py-2"
          >
            {LIFECYCLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/-/g, ' ')}
              </option>
            ))}
          </select>
        </FieldLabel>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === 'loading'}
          className="rounded-md bg-signal-500 px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Calling…' : 'Run advisor'}
        </button>
      </section>

      {state.status === 'idle' ? (
        <AdvisorEmpty
          title="Awaiting selection"
          hint="Pick an asset + stage to surface the next-best action with citations and alternatives."
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
            aria-label={`Next best action for ${state.data.assetId}`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                Next best action · {state.data.nextBestAction.domain}
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.62rem] uppercase tracking-wider ${priorityTone(state.data.nextBestAction.priority)}`}
                >
                  {state.data.nextBestAction.priority}
                </span>
                <span className="text-xs text-neutral-500">
                  Confidence{' '}
                  {(state.data.nextBestAction.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <p className="text-lg text-foreground font-medium mb-2">
              {state.data.nextBestAction.action}
            </p>
            <p className="text-sm text-neutral-400 mb-3">
              {state.data.nextBestAction.rationale}
            </p>
            {state.data.nextBestAction.citations.length > 0 ? (
              <CitationList citations={state.data.nextBestAction.citations} />
            ) : null}
          </article>

          {state.data.recommendations.length > 1 ? (
            <article className="platform-card">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">
                Alternatives ({state.data.recommendations.length - 1})
              </h3>
              <ul className="space-y-3">
                {state.data.recommendations
                  .filter((r) => r.action !== state.data!.nextBestAction.action)
                  .map((r, i) => (
                    <li
                      key={i}
                      className="border-l-2 border-border pl-3 text-sm"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs uppercase tracking-wider text-neutral-500">
                          {r.domain}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.62rem] uppercase tracking-wider ${priorityTone(r.priority)}`}
                        >
                          {r.priority}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {(r.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-foreground">{r.action}</div>
                      <div className="text-xs text-neutral-400">
                        {r.rationale}
                      </div>
                    </li>
                  ))}
              </ul>
            </article>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function CitationList({
  citations,
}: {
  readonly citations: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <ul className="text-xs text-neutral-500 space-y-1" aria-label="Citations">
      {citations.map((c, i) => (
        <li key={i}>
          <span className="text-signal-500" aria-hidden>
            §
          </span>{' '}
          {c}
        </li>
      ))}
    </ul>
  );
}
