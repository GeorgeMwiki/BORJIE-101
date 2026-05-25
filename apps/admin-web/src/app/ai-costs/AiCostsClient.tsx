'use client';

/**
 * AI spend monitor — migrated from apps/admin-portal/src/pages/AiCosts.tsx.
 *
 *   GET /api/v1/ai-costs/summary  — current-month totals + per-model breakdown
 *   GET /api/v1/ai-costs/entries  — recent LLM call entries
 *   GET /api/v1/ai-costs/budget   — monthly cap (null if unset)
 *   PUT /api/v1/ai-costs/budget   — admin sets cap
 *
 * Cost figures come back as USD-micro (1e-6 USD); we render them as USD.
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, DollarSign, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

interface ModelBreakdownRow {
  readonly model: string;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsdMicro: number;
}

interface Summary {
  readonly totalCostUsdMicro: number;
  readonly totalCalls: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly perModel: readonly ModelBreakdownRow[];
}

interface Budget {
  readonly monthlyCapUsdMicro: number;
  readonly hardStop: boolean;
  readonly updatedAt?: string;
}

interface SummaryResponse {
  readonly summary: Summary;
  readonly budget: Budget | null;
  readonly overBudget: boolean;
}

interface Entry {
  readonly id: string;
  readonly model: string;
  readonly costUsdMicro: number;
  readonly createdAt: string;
  readonly purpose?: string;
}

function dollars(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function AiCostsClient() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftCap, setDraftCap] = useState('');
  const [hardStop, setHardStop] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, e] = await Promise.all([
      api.get<SummaryResponse>('/ai-costs/summary'),
      api.get<readonly Entry[]>('/ai-costs/entries'),
    ]);
    if (s.success && s.data) {
      setSummary(s.data);
      if (s.data.budget) {
        setDraftCap((s.data.budget.monthlyCapUsdMicro / 1_000_000).toString());
        setHardStop(s.data.budget.hardStop);
      }
    } else {
      setError(s.error ?? 'Failed to load summary');
    }
    if (e.success && e.data) setEntries(e.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget(): Promise<void> {
    const capUsd = Number(draftCap);
    if (!Number.isFinite(capUsd) || capUsd < 0) {
      setError('Cap must be a non-negative number');
      return;
    }
    const res = await api.put('/ai-costs/budget', {
      monthlyCapUsdMicro: Math.round(capUsd * 1_000_000),
      hardStop,
    });
    if (res.success) {
      void load();
    } else {
      setError(res.error ?? 'Failed to save budget');
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-neutral-400 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-amber-500" />
        <p className="text-sm text-neutral-400">
          Per-model LLM spend across the platform.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {summary && (
        <>
          {summary.overBudget && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Monthly budget exceeded.
            </div>
          )}

          <section className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="This month"
              value={dollars(summary.summary.totalCostUsdMicro)}
            />
            <StatCard
              label="Calls"
              value={summary.summary.totalCalls.toLocaleString()}
            />
            <StatCard
              label="Cap"
              value={
                summary.budget ? dollars(summary.budget.monthlyCapUsdMicro) : '—'
              }
            />
          </section>

          <section className="platform-card">
            <h3 className="font-display text-foreground mb-3">Per model</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="py-2">Model</th>
                  <th>Calls</th>
                  <th>Prompt tokens</th>
                  <th>Completion tokens</th>
                  <th className="text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.summary.perModel.map((row) => (
                  <tr
                    key={row.model}
                    className="border-t border-border/40 text-neutral-200"
                  >
                    <td className="py-2 font-medium">{row.model}</td>
                    <td>{row.calls}</td>
                    <td>{row.promptTokens.toLocaleString()}</td>
                    <td>{row.completionTokens.toLocaleString()}</td>
                    <td className="text-right">{dollars(row.costUsdMicro)}</td>
                  </tr>
                ))}
                {summary.summary.perModel.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-3 text-center text-neutral-500"
                    >
                      No usage recorded this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="platform-card max-w-xl space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-amber-500" />
              <h3 className="font-display text-foreground">Monthly cap</h3>
            </div>
            <label className="block text-sm">
              <span className="text-neutral-300">Cap (USD)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={draftCap}
                onChange={(e) => setDraftCap(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
                data-testid="ai-cost-cap"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={hardStop}
                onChange={(e) => setHardStop(e.target.checked)}
              />
              Hard stop when cap reached
            </label>
            <button
              type="button"
              onClick={() => void saveBudget()}
              className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-black"
            >
              Save
            </button>
          </section>

          <section className="platform-card">
            <h3 className="font-display text-foreground mb-3">Recent calls</h3>
            <ul className="space-y-2 text-sm">
              {entries.slice(0, 20).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between border-b border-border/40 py-1 last:border-b-0"
                >
                  <span>
                    <span className="font-medium text-foreground">{e.model}</span>
                    {e.purpose ? (
                      <span className="text-neutral-500"> — {e.purpose}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {dollars(e.costUsdMicro)} ·{' '}
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
              {entries.length === 0 && (
                <li className="text-neutral-500">No recent calls.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="platform-card">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-display text-foreground">{value}</p>
    </div>
  );
}
