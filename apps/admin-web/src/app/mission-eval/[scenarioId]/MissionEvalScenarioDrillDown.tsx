'use client';

/**
 * Mission-eval scenario drill-down client — Phase D / D12.11.
 *
 * Fetches:
 *   GET  /api/v1/parity/capability/dashboard/scenarios/:scenarioId/samples
 *
 * Renders a sortable / filterable table of CoT samples for the chosen
 * scenario id, plus a slide-over drawer with the full CoT text + judge
 * verdict + 5-C rubric breakdown.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

export interface MissionEvalScenarioDrillDownProps {
  readonly scenarioId: string;
}

interface CotSample {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly capturedAt: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly judgeScore: number | null;
  readonly judgeReasonText: string | null;
  readonly judgeSuggestedFix: string | null;
  readonly cotThoughtText: string | null;
  readonly modelId: string | null;
  readonly sensorId: string | null;
  readonly rubric?: {
    readonly completeness: number;
    readonly correctness: number;
    readonly citations: number;
    readonly consistency: number;
    readonly candor: number;
  };
  readonly weakestAxis?: string;
}

interface SamplesResponse {
  readonly scenarioId: string;
  readonly samples: ReadonlyArray<CotSample>;
  readonly total: number;
  readonly generatedAt: string;
}

function scoreBadge(score: number | null): string {
  if (score === null) return 'bg-neutral-700 text-neutral-300';
  if (score < 0.5) return 'bg-rose-500/20 text-rose-300';
  if (score < 0.8) return 'bg-amber-500/20 text-amber-300';
  return 'bg-emerald-500/20 text-emerald-300';
}

export function MissionEvalScenarioDrillDown({
  scenarioId,
}: MissionEvalScenarioDrillDownProps): JSX.Element {
  const [samples, setSamples] = useState<ReadonlyArray<CotSample>>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadSamples = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = `/api/v1/parity/capability/dashboard/scenarios/${encodeURIComponent(scenarioId)}/samples`;
      const res = await api.get<SamplesResponse>(path);
      // `api.get<T>` returns `ApiResponse<T>` — unwrap the data envelope.
      setSamples(res.data?.samples ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load samples');
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  const selectedSample = useMemo(
    () => samples.find((s) => s.thoughtId === selectedId) ?? null,
    [samples, selectedId],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">
            {samples.length} sample{samples.length === 1 ? '' : 's'} captured
            <span className="ml-2 text-neutral-400">
              (total: {total.toLocaleString()})
            </span>
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Click any row to inspect the full CoT, judge verdict, and 5-C rubric
            breakdown.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSamples()}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-800"
          data-testid="refresh-button"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-rose-700 bg-rose-950/50 p-3 text-sm text-rose-200"
        >
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="rounded-md border border-neutral-800 bg-neutral-950">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading samples…
          </div>
        ) : samples.length === 0 ? (
          <div className="p-6 text-sm text-neutral-400">
            No CoT samples captured for scenario <code>{scenarioId}</code> yet.
          </div>
        ) : (
          <table className="w-full divide-y divide-neutral-800 text-sm">
            <thead className="bg-neutral-900/50 text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Captured</th>
                <th className="px-3 py-2 text-left font-medium">Stakes</th>
                <th className="px-3 py-2 text-left font-medium">Judge score</th>
                <th className="px-3 py-2 text-left font-medium">Weakest axis</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {samples.map((s) => (
                <tr
                  key={s.thoughtId}
                  onClick={() => setSelectedId(s.thoughtId)}
                  className="cursor-pointer hover:bg-neutral-900/50"
                  data-testid={`sample-row-${s.thoughtId}`}
                >
                  <td className="px-3 py-2 text-neutral-300">
                    {new Date(s.capturedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{s.stakes}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${scoreBadge(s.judgeScore)}`}
                    >
                      {s.judgeScore === null ? 'n/a' : s.judgeScore.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    {s.weakestAxis ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    {s.modelId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedSample && (
        <aside
          role="dialog"
          aria-label="CoT sample detail"
          className="fixed right-0 top-0 z-40 h-full w-full max-w-xl overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-6 text-sm text-neutral-200 shadow-2xl"
        >
          <header className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-neutral-50">
              Thought {selectedSample.thoughtId.slice(0, 12)}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-800"
              data-testid="close-drawer"
            >
              Close
            </button>
          </header>
          <dl className="space-y-3">
            <Pair label="Thread" value={selectedSample.threadId} />
            <Pair label="Captured" value={selectedSample.capturedAt} />
            <Pair label="Stakes" value={selectedSample.stakes} />
            <Pair label="Model" value={selectedSample.modelId ?? '—'} />
            <Pair label="Sensor" value={selectedSample.sensorId ?? '—'} />
            <Pair
              label="Judge score"
              value={
                selectedSample.judgeScore === null
                  ? 'n/a'
                  : selectedSample.judgeScore.toFixed(2)
              }
            />
            <Pair
              label="Judge reason"
              value={selectedSample.judgeReasonText ?? '—'}
            />
            <Pair
              label="Suggested fix"
              value={selectedSample.judgeSuggestedFix ?? '—'}
            />
            {selectedSample.rubric && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-400">
                  5-C rubric
                </dt>
                <dd className="mt-1 grid grid-cols-5 gap-2 text-xs">
                  <RubricCell label="comp." value={selectedSample.rubric.completeness} />
                  <RubricCell label="corr." value={selectedSample.rubric.correctness} />
                  <RubricCell label="cite" value={selectedSample.rubric.citations} />
                  <RubricCell label="cons." value={selectedSample.rubric.consistency} />
                  <RubricCell label="cand." value={selectedSample.rubric.candor} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-400">
                CoT thought (PII-scrubbed)
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-300">
                {selectedSample.cotThoughtText ?? '— no CoT captured —'}
              </dd>
            </div>
          </dl>
        </aside>
      )}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="col-span-2 text-neutral-200">{value}</dd>
    </div>
  );
}

function RubricCell({
  label,
  value,
}: {
  label: string;
  value: number;
}): JSX.Element {
  const colour =
    value >= 0.8
      ? 'text-emerald-300'
      : value >= 0.5
        ? 'text-amber-300'
        : 'text-rose-300';
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/50 p-1 text-center">
      <div className={`font-mono text-sm ${colour}`}>{value.toFixed(2)}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
    </div>
  );
}
