'use client';

/**
 * HQ AI-model spend overview (AD-3) — renders the REAL per-model rollup from
 * the `ai_cost_entries` ledger. No fabricated junior assignments or invented
 * p50 latency; a platform with no LLM calls yet shows an honest empty state.
 */

import { StubBadge } from '@/components/internal/StubBadge';
import { useModelsOverviewQuery } from '@/lib/internal/queries/models';

const fmtUsd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (n: number): string => n.toLocaleString();

const fmtWhen = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

export function ModelsOverview(): JSX.Element {
  const query = useModelsOverviewQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading model spend…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-neutral-400">No model spend recorded yet.</p>
        <p className="mt-1 text-xs text-neutral-500">
          Rows appear here once LLM calls land in the cost ledger.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-surface-sunken">
          <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
            <th className="px-4 py-3 font-medium">Provider</th>
            <th className="px-4 py-3 font-medium">Model</th>
            <th className="px-4 py-3 font-medium text-right">Calls</th>
            <th className="px-4 py-3 font-medium text-right">In tokens</th>
            <th className="px-4 py-3 font-medium text-right">Out tokens</th>
            <th className="px-4 py-3 font-medium text-right">Spend (window)</th>
            <th className="px-4 py-3 font-medium text-right">Last used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.provider}:${row.model}`}
              className="border-b border-border last:border-0"
            >
              <td className="px-4 py-3">
                <StubBadge tone="neutral">{row.provider}</StubBadge>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                {row.model}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                {fmtInt(row.calls)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                {fmtInt(row.inputTokens)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                {fmtInt(row.outputTokens)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                {fmtUsd(row.costUsd)}
              </td>
              <td className="px-4 py-3 text-right text-xs text-neutral-400">
                {fmtWhen(row.lastUsedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
