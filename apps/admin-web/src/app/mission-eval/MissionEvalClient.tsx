'use client';

/**
 * Mission-eval interactive client — Wave-K parity-litfin.
 *
 * Calls:
 *   GET  /api/v1/parity/capability/dashboard         — rollup tile
 *   GET  /api/v1/parity/capability/dashboard/runs    — filtered list
 *   GET  /api/v1/parity/capability/dashboard/runs/:id — drill
 *   POST /api/v1/parity/capability/dashboard/runs/:id/judge — re-judge
 *
 * Filters: capability, score range, scenario category. Click a row to
 * open a drawer with captured CoT (PII-scrubbed) + judge score + reason
 * + a "re-judge" button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, RefreshCcw } from 'lucide-react';
import { api } from '@/lib/api';

const CAPABILITIES = [
  { id: 'rent-reconciliation', label: 'Rent reconciliation' },
  { id: 'lease-renewal', label: 'Lease renewal' },
  { id: 'kra-mri', label: 'KRA MRI' },
  { id: 'gepg', label: 'GePG' },
  { id: 'maintenance-triage', label: 'Maintenance triage' },
  { id: 'voice-agent', label: 'Voice agent' },
] as const;

type CapabilityId = (typeof CAPABILITIES)[number]['id'];

interface CapabilityTile {
  readonly id: string;
  readonly runsLast24h: number;
  readonly meanJudgeScore: number | null;
  readonly regenRateLast24h: number | null;
}

interface DashboardRollup {
  readonly capabilities: ReadonlyArray<CapabilityTile>;
  readonly totals: { provenanceCount: number; cotSampleCount: number };
  readonly generatedAt: string;
  readonly degraded?: boolean;
}

interface EvalRunRow {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly judgeScore: number | null;
  readonly category: string | null;
  readonly capability: string | null;
  readonly producedAt: string;
}

interface EvalRunDetail extends EvalRunRow {
  readonly cotThoughtText: string | null;
  readonly judgeReasonText?: string | null;
  readonly judgeSuggestedFix?: string | null;
  readonly promptHash?: string | null;
  readonly responseHash?: string | null;
  readonly modelId?: string;
  readonly sensorId?: string;
}

function scoreBadge(score: number | null): string {
  if (score === null) return 'bg-neutral-700 text-neutral-300';
  if (score < 0.5) return 'bg-rose-500/20 text-rose-300';
  if (score < 0.8) return 'bg-amber-500/20 text-amber-300';
  return 'bg-emerald-500/20 text-emerald-300';
}

export function MissionEvalClient() {
  const [rollup, setRollup] = useState<DashboardRollup | null>(null);
  const [rows, setRows] = useState<ReadonlyArray<EvalRunRow>>([]);
  const [total, setTotal] = useState<number>(0);
  const [loadingRollup, setLoadingRollup] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<CapabilityId | ''>('');
  const [minScore, setMinScore] = useState<string>('');
  const [maxScore, setMaxScore] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [selected, setSelected] = useState<EvalRunDetail | null>(null);
  const [rejudging, setRejudging] = useState(false);

  const loadRollup = useCallback(async () => {
    setLoadingRollup(true);
    setError(null);
    const res = await api.get<DashboardRollup>('/parity/capability/dashboard');
    if (res.success && res.data) {
      setRollup(res.data);
    } else {
      setError(res.error ?? 'Failed to load capability rollup');
    }
    setLoadingRollup(false);
  }, []);

  const loadRuns = useCallback(async () => {
    setLoadingRows(true);
    setError(null);
    const params = new URLSearchParams();
    if (capability) params.set('capability', capability);
    if (minScore) params.set('minScore', minScore);
    if (maxScore) params.set('maxScore', maxScore);
    if (category) params.set('category', category);
    params.set('limit', '50');
    const path = `/parity/capability/dashboard/runs?${params.toString()}`;
    const res = await api.get<ReadonlyArray<EvalRunRow>>(path);
    if (res.success && res.data) {
      setRows(res.data);
      const meta = (res as unknown as { meta?: { total?: number } }).meta;
      setTotal(meta?.total ?? res.data.length);
    } else {
      setError(res.error ?? 'Failed to load eval runs');
      setRows([]);
      setTotal(0);
    }
    setLoadingRows(false);
  }, [capability, minScore, maxScore, category]);

  useEffect(() => {
    void loadRollup();
  }, [loadRollup]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function openDetail(row: EvalRunRow): Promise<void> {
    setSelected({ ...row, cotThoughtText: null });
    const res = await api.get<EvalRunDetail>(
      `/parity/capability/dashboard/runs/${encodeURIComponent(row.thoughtId)}`,
    );
    if (res.success && res.data) {
      setSelected(res.data);
    }
  }

  async function rejudge(thoughtId: string): Promise<void> {
    setRejudging(true);
    const res = await api.post<EvalRunDetail>(
      `/parity/capability/dashboard/runs/${encodeURIComponent(thoughtId)}/judge`,
      {},
    );
    setRejudging(false);
    if (res.success && res.data) {
      setSelected(res.data);
      setRows((prev) =>
        prev.map((r) =>
          r.thoughtId === thoughtId
            ? { ...r, judgeScore: res.data!.judgeScore }
            : r,
        ),
      );
    } else {
      setError(res.error ?? 'Re-judge failed');
    }
  }

  const filterControlsDisabled = useMemo(
    () => loadingRollup && rows.length === 0,
    [loadingRollup, rows.length],
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Capability rollup tiles */}
      <section
        aria-label="Capability rollup"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {loadingRollup && (
          <div className="platform-card col-span-full flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rollup…
          </div>
        )}
        {!loadingRollup &&
          rollup?.capabilities.map((tile) => (
            <article
              key={tile.id}
              data-testid={`capability-tile-${tile.id}`}
              className="platform-card flex flex-col gap-2"
            >
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {CAPABILITIES.find((c) => c.id === tile.id)?.label ?? tile.id}
                </h3>
                <ShieldCheck className="h-4 w-4 text-indigo-400" />
              </header>
              <dl className="grid grid-cols-3 gap-2 text-xs text-neutral-400">
                <div>
                  <dt>Runs (24h)</dt>
                  <dd className="text-base font-mono text-foreground">
                    {tile.runsLast24h}
                  </dd>
                </div>
                <div>
                  <dt>Mean judge</dt>
                  <dd className="text-base font-mono text-foreground">
                    {tile.meanJudgeScore === null
                      ? '—'
                      : tile.meanJudgeScore.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>Regen rate</dt>
                  <dd className="text-base font-mono text-foreground">
                    {tile.regenRateLast24h === null
                      ? '—'
                      : `${(tile.regenRateLast24h * 100).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        {rollup?.degraded && (
          <div className="platform-card col-span-full text-xs text-neutral-500">
            Degraded view — substrate service is not wired in this environment.
          </div>
        )}
      </section>

      {/* Filters */}
      <section
        aria-label="Filters"
        className="platform-card flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col text-xs text-neutral-400">
          Capability
          <select
            data-testid="filter-capability"
            value={capability}
            onChange={(e) => setCapability(e.target.value as CapabilityId | '')}
            disabled={filterControlsDisabled}
            className="mt-1 rounded border border-border/40 bg-surface-sunken px-2 py-1 text-sm text-foreground"
          >
            <option value="">All</option>
            {CAPABILITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Min score
          <input
            data-testid="filter-min-score"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            className="mt-1 w-24 rounded border border-border/40 bg-surface-sunken px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Max score
          <input
            data-testid="filter-max-score"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            className="mt-1 w-24 rounded border border-border/40 bg-surface-sunken px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Scenario category
          <input
            data-testid="filter-category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="refusal, drift, policy…"
            className="mt-1 w-44 rounded border border-border/40 bg-surface-sunken px-2 py-1 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loadingRows}
          className="flex items-center gap-1 rounded-md bg-indigo-500/20 px-3 py-1.5 text-sm text-indigo-200 hover:bg-indigo-500/30"
        >
          <RefreshCcw className="h-4 w-4" /> Refresh
        </button>
      </section>

      {/* Runs table */}
      <section
        aria-label="Eval runs"
        className="platform-card overflow-hidden"
        data-testid="eval-runs-table"
      >
        {loadingRows && (
          <div className="flex items-center gap-2 p-4 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
          </div>
        )}
        {!loadingRows && rows.length === 0 && !error && (
          <div className="p-6 text-center text-sm text-neutral-500">
            No eval runs match these filters.
          </div>
        )}
        {!loadingRows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/40 text-xs text-neutral-400">
              <tr>
                <th className="px-3 py-2">Thought</th>
                <th className="px-3 py-2">Stakes</th>
                <th className="px-3 py-2">Capability</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Judge</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.thoughtId}
                  data-testid={`eval-row-${r.thoughtId}`}
                  onClick={() => void openDetail(r)}
                  className="cursor-pointer border-b border-border/30 hover:bg-surface-sunken/50"
                >
                  <td className="px-3 py-2 font-mono text-xs text-neutral-300">
                    {r.thoughtId.slice(0, 12)}…
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-300">
                    {r.stakes}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-300">
                    {r.capability ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-300">
                    {r.category ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${scoreBadge(r.judgeScore)}`}
                    >
                      {r.judgeScore === null ? '—' : r.judgeScore.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">
                    {new Date(r.producedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > rows.length && (
          <p className="px-3 py-2 text-xs text-neutral-500">
            Showing {rows.length} of {total} runs (refine filters to narrow).
          </p>
        )}
      </section>

      {/* Detail drawer */}
      {selected && (
        <aside
          data-testid="detail-drawer"
          className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l border-border/40 bg-surface-sunken p-6 shadow-2xl"
        >
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Captured eval run
              </h2>
              <p className="font-mono text-xs text-neutral-400">
                {selected.thoughtId}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-neutral-400 hover:text-foreground"
              aria-label="Close drawer"
            >
              Close
            </button>
          </header>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-400">Judge score</dt>
              <dd className="font-mono text-base text-foreground">
                <span
                  className={`inline-block rounded px-2 py-0.5 ${scoreBadge(selected.judgeScore)}`}
                >
                  {selected.judgeScore === null
                    ? '—'
                    : selected.judgeScore.toFixed(2)}
                </span>
              </dd>
            </div>
            {selected.judgeReasonText && (
              <div>
                <dt className="text-xs text-neutral-400">Judge reason</dt>
                <dd className="text-sm text-foreground">
                  {selected.judgeReasonText}
                </dd>
              </div>
            )}
            {selected.judgeSuggestedFix && (
              <div>
                <dt className="text-xs text-neutral-400">Suggested fix</dt>
                <dd className="text-sm text-foreground">
                  {selected.judgeSuggestedFix}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-neutral-400">
                Captured chain-of-thought (PII-scrubbed)
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-neutral-900 p-3 font-mono text-xs text-neutral-200">
                {selected.cotThoughtText ?? '— (not captured at sampling)'}
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-neutral-400">
              <div>
                <dt>Stakes</dt>
                <dd className="text-neutral-200">{selected.stakes}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="text-neutral-200">{selected.modelId ?? '—'}</dd>
              </div>
              <div>
                <dt>Prompt hash</dt>
                <dd className="break-all font-mono text-tiny text-neutral-500">
                  {selected.promptHash ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Response hash</dt>
                <dd className="break-all font-mono text-tiny text-neutral-500">
                  {selected.responseHash ?? '—'}
                </dd>
              </div>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => void rejudge(selected.thoughtId)}
            disabled={rejudging}
            data-testid="rejudge-button"
            className="mt-6 w-full rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {rejudging ? 'Re-judging…' : 'Re-judge with current rubric'}
          </button>
        </aside>
      )}
    </div>
  );
}
