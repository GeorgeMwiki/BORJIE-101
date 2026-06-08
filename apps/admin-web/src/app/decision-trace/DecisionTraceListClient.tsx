'use client';

/**
 * DecisionTrace list (admin replay UI) — INV-A / FIRE-2.
 *
 * METADATA-ONLY. This client fetches the metadata-only projection from the
 * gateway:
 *
 *   GET /api/v1/mining/internal/decision-trace?tenant=&outcome=&limit=
 *
 * It NEVER reads decision CONTENT (inputs / branches / rationale / output /
 * attributes) — that crosses the control-plane wall and is served only under
 * a tenant-consented break-glass grant on the detail page. The
 * SUPABASE_SERVICE_ROLE_KEY that the previous server-component held has been
 * removed entirely; auth is the platform-session cookie carried by `api`.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface TraceMetaRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly startedAt: string;
  readonly finalisedAt: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly chosenBranchId: string | null;
}

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  approved: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  executed: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  rejected: 'bg-rose-900/40 text-rose-300 border-rose-700',
  refused: 'bg-amber-900/40 text-amber-300 border-amber-700',
  failed: 'bg-rose-900/60 text-rose-200 border-rose-600',
};

function badge(outcome: string): string {
  return (
    // eslint-disable-next-line security/detect-object-injection -- closed const map, ?? guards unknown keys
    OUTCOME_BADGE_CLASS[outcome] ??
    'bg-neutral-800 text-neutral-300 border-neutral-700'
  );
}

export function DecisionTraceListClient() {
  const [rows, setRows] = useState<readonly TraceMetaRow[]>([]);
  const [tenant, setTenant] = useState('');
  const [outcome, setOutcome] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (tenant) qs.set('tenant', tenant);
    if (outcome) qs.set('outcome', outcome);
    qs.set('limit', '50');
    const res = await api.get<readonly TraceMetaRow[]>(
      `/mining/internal/decision-trace?${qs.toString()}`,
    );
    setLoading(false);
    if (res.success && res.data) setRows(res.data);
    else setError(res.error ?? 'Failed to load traces');
  }, [tenant, outcome]);

  useEffect(() => {
    void load();
    // initial load only; filter button re-runs explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-500">
        Metadata-only fleet view. Decision content (inputs, branches, rationale,
        output) is tenant business data — open a trace to request tenant-consented
        break-glass access.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap gap-3 items-end"
      >
        <label className="flex flex-col text-xs text-neutral-400">
          Tenant
          <input
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="any tenant"
            className="mt-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-100 w-48"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Outcome
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="mt-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-100"
          >
            <option value="">any</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="executed">executed</option>
            <option value="refused">refused</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <button
          type="submit"
          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm rounded font-medium"
        >
          Filter
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="text-xs text-neutral-400">
        {loading ? 'Loading…' : `${rows.length} trace${rows.length === 1 ? '' : 's'}`}
      </div>

      {!loading && rows.length === 0 && !error ? (
        <div className="p-12 border border-dashed border-neutral-700 rounded text-center text-sm text-neutral-400">
          No traces match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-800 rounded">
          <table className="min-w-full divide-y divide-neutral-800 text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Started</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">Tenant</th>
                <th className="px-4 py-2 text-left">Outcome</th>
                <th className="px-4 py-2 text-right">Duration</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 text-neutral-200">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-900/60">
                  <td className="px-4 py-2 font-mono text-xs">
                    {new Date(row.startedAt).toISOString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{row.name}</td>
                  <td className="px-4 py-2 text-xs">
                    {row.tenantId ?? (
                      <span className="text-neutral-500 italic">platform</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-1 text-xs rounded border ${badge(row.outcome)}`}
                    >
                      {row.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-neutral-400">
                    {row.durationMs}ms
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/decision-trace/${encodeURIComponent(row.id)}${
                        row.tenantId ? `?tenant=${encodeURIComponent(row.tenantId)}` : ''
                      }`}
                      className="text-amber-400 hover:text-amber-200 text-xs"
                    >
                      Inspect →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
