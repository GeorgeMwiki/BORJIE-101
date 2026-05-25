/**
 * DecisionTrace list view (admin replay UI).
 *
 * Server component — reads recent traces from `decision_traces` via the
 * service-role Supabase client (bypasses RLS by design; platform-staff
 * surface). Supports two filters:
 *   - `?tenant=<id>` — restrict to one tenant.
 *   - `?outcome=<approved|rejected|executed|refused|failed>` — outcome filter.
 * Plus standard pagination via `?page=<n>` (50 rows per page).
 *
 * The page is intentionally read-only — write actions on traces (delete,
 * tag) would break the append-only audit contract documented in
 * `packages/observability/src/decision-trace/persistence-port.ts`.
 *
 * Scaffold note: when the Supabase service-role env vars are absent we
 * render an empty-state panel rather than crashing the route. Wiring
 * happens at deploy time via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 */

import Link from 'next/link';
import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type TraceListRow = {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly started_at: string;
  readonly finalised_at: string;
  readonly duration_ms: number;
  readonly outcome: string;
  readonly chosen_branch_id: string | null;
};

type PageProps = {
  readonly searchParams: Promise<{
    tenant?: string;
    outcome?: string;
    page?: string;
  }>;
};

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  approved: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  executed: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  rejected: 'bg-rose-900/40 text-rose-300 border-rose-700',
  refused: 'bg-amber-900/40 text-amber-300 border-amber-700',
  failed: 'bg-rose-900/60 text-rose-200 border-rose-600',
};

function outcomeBadge(outcome: string): string {
  return (
    // eslint-disable-next-line security/detect-object-injection -- OUTCOME_BADGE_CLASS is a closed const map, ?? guards unknown keys
    OUTCOME_BADGE_CLASS[outcome] ??
    'bg-neutral-800 text-neutral-300 border-neutral-700'
  );
}

/**
 * Pull recent traces. Returns null when the service-role client is not
 * configured — the page renders a LiveDataRequiredPanel in that case.
 */
async function fetchTraces(
  tenant: string | undefined,
  outcome: string | undefined,
  offset: number,
): Promise<{ rows: TraceListRow[]; total: number } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  // Lazy import keeps the bundle small for routes that don't need Supabase.
  const { createClient } = await import('@supabase/supabase-js').catch(
    () => ({ createClient: null as never }),
  );
  if (!createClient) return null;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = client
    .from('decision_traces')
    .select(
      'id, tenant_id, name, started_at, finalised_at, duration_ms, outcome, chosen_branch_id',
      { count: 'exact' },
    )
    .order('started_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (tenant && tenant.length > 0) query = query.eq('tenant_id', tenant);
  if (outcome && outcome.length > 0) query = query.eq('outcome', outcome);

  const { data, error, count } = await query;
  if (error || !data) return { rows: [], total: 0 };
  return { rows: data as TraceListRow[], total: count ?? data.length };
}

export default async function DecisionTraceListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tenant = params.tenant?.trim();
  const outcome = params.outcome?.trim();
  const pageNum = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const result = await fetchTraces(tenant, outcome, offset);

  if (!result) {
    return (
      <PageShell
        title="Decision Trace Replay"
        subtitle="Structured audit replay for brain decisions, four-eye approvals, payouts, and tenant resolution."
      >
        <LiveDataRequiredPanel
          feature="Decision Trace Replay"
          description="The decision-trace store is not yet wired in this environment. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable the audit replay UI."
        />
      </PageShell>
    );
  }

  const { rows, total } = result;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const next = new URLSearchParams();
    const merged = {
      tenant,
      outcome,
      page: String(pageNum),
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v.length > 0) next.set(k, v);
    }
    const qs = next.toString();
    return `/decision-trace${qs ? `?${qs}` : ''}`;
  };

  return (
    <PageShell
      title="Decision Trace Replay"
      subtitle="Structured audit replay for brain decisions, four-eye approvals, payouts, and tenant resolution. Service-role read; bypasses tenant RLS."
    >
      <form
        method="GET"
        action="/decision-trace"
        className="flex flex-wrap gap-3 items-end mb-6"
      >
        <label className="flex flex-col text-xs text-neutral-400">
          Tenant
          <input
            type="text"
            name="tenant"
            defaultValue={tenant ?? ''}
            placeholder="any tenant"
            className="mt-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-100 w-48"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Outcome
          <select
            name="outcome"
            defaultValue={outcome ?? ''}
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
        {tenant || outcome ? (
          <Link
            href="/decision-trace"
            className="px-4 py-2 text-sm text-neutral-300 hover:text-white"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="text-xs text-neutral-400 mb-3">
        {total} trace{total === 1 ? '' : 's'} — page {pageNum} of {totalPages}
      </div>

      {rows.length === 0 ? (
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
                <th className="px-4 py-2 text-left">Chosen</th>
                <th className="px-4 py-2 text-right">Duration</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 text-neutral-200">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-900/60">
                  <td className="px-4 py-2 font-mono text-xs">
                    {new Date(row.started_at).toISOString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{row.name}</td>
                  <td className="px-4 py-2 text-xs">
                    {row.tenant_id ?? (
                      <span className="text-neutral-500 italic">platform</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-1 text-xs rounded border ${outcomeBadge(row.outcome)}`}
                    >
                      {row.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-300">
                    {row.chosen_branch_id ?? (
                      <span className="text-neutral-500 italic">none</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-neutral-400">
                    {row.duration_ms}ms
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/decision-trace/${encodeURIComponent(row.id)}`}
                      className="text-amber-400 hover:text-amber-200 text-xs"
                    >
                      Replay →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex justify-between mt-6 text-sm">
        {pageNum > 1 ? (
          <Link
            href={buildHref({ page: String(pageNum - 1) })}
            className="text-amber-400 hover:text-amber-200"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {pageNum < totalPages ? (
          <Link
            href={buildHref({ page: String(pageNum + 1) })}
            className="text-amber-400 hover:text-amber-200"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </PageShell>
  );
}
