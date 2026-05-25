/**
 * DecisionTrace replay detail view.
 *
 * Server component — reads a single trace by id from `decision_traces`
 * via the service-role Supabase client (admin replay UI bypasses tenant
 * RLS by design). Renders the trace as a vertical timeline:
 *
 *   - Header card: name, outcome, tenant, started/finalised, duration.
 *   - Inputs panel: JSON-formatted snapshot of what the decision saw.
 *   - Branches timeline: each alternative branch the decision considered
 *     with rationale + score; the chosen branch is highlighted.
 *   - Output / error panel: final payload or failure reason.
 *   - Attributes panel: free-form metadata attached via `addAttribute`.
 *
 * Missing trace ⇒ `notFound()` (Next.js 404). Service-role env vars
 * absent ⇒ live-data panel; never crashes the route.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';

export const dynamic = 'force-dynamic';

type Branch = {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly score?: number;
  readonly metadata?: Record<string, unknown>;
  readonly recordedAt?: string;
};

type TraceRow = {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly started_at: string;
  readonly finalised_at: string;
  readonly duration_ms: number;
  readonly inputs: Record<string, unknown>;
  readonly branches: ReadonlyArray<Branch>;
  readonly chosen_branch_id: string | null;
  readonly chosen_rationale: string | null;
  readonly outcome: string;
  readonly attributes: Record<string, unknown>;
  readonly output: unknown;
  readonly error: string | null;
  readonly user_id: string | null;
  readonly request_id: string | null;
  readonly parent_trace_id: string | null;
};

type PageProps = {
  readonly params: Promise<{ id: string }>;
};

const OUTCOME_COLOR: Record<string, string> = {
  approved: 'text-emerald-300 border-emerald-700 bg-emerald-900/30',
  executed: 'text-emerald-300 border-emerald-700 bg-emerald-900/30',
  rejected: 'text-rose-300 border-rose-700 bg-rose-900/30',
  refused: 'text-amber-300 border-amber-700 bg-amber-900/30',
  failed: 'text-rose-200 border-rose-600 bg-rose-900/50',
};

async function fetchTrace(id: string): Promise<TraceRow | null | 'unconfigured'> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 'unconfigured';

  const { createClient } = await import('@supabase/supabase-js').catch(
    () => ({ createClient: null as never }),
  );
  if (!createClient) return 'unconfigured';

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from('decision_traces')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as TraceRow;
}

function jsonBlock(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function DecisionTraceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const result = await fetchTrace(id);

  if (result === 'unconfigured') {
    return (
      <PageShell title="Decision Trace Replay">
        <LiveDataRequiredPanel
          feature="Decision Trace Replay"
          description="The decision-trace store is not yet wired. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable replay."
        />
      </PageShell>
    );
  }

  if (!result) {
    notFound();
  }

  const trace = result;
  const outcomeClass =
    OUTCOME_COLOR[trace.outcome] ??
    'text-neutral-300 border-neutral-700 bg-neutral-900';
  const branches = Array.isArray(trace.branches) ? trace.branches : [];

  return (
    <PageShell
      title="Decision Trace Replay"
      subtitle={trace.name}
    >
      <div className="mb-4 text-xs">
        <Link
          href="/decision-trace"
          className="text-amber-400 hover:text-amber-200"
        >
          ← Back to list
        </Link>
      </div>

      <section
        className={`p-5 border rounded mb-6 ${outcomeClass}`}
        aria-label="Trace summary"
      >
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">
              Action
            </div>
            <div className="font-mono text-lg">{trace.name}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">
              Outcome
            </div>
            <div className="font-mono text-lg uppercase">{trace.outcome}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">
              Tenant
            </div>
            <div className="font-mono text-sm">
              {trace.tenant_id ?? <span className="italic">platform</span>}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">
              Duration
            </div>
            <div className="font-mono text-sm">{trace.duration_ms}ms</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono opacity-90">
          <div>
            <span className="opacity-70">id:</span> {trace.id}
          </div>
          <div>
            <span className="opacity-70">started:</span>{' '}
            {new Date(trace.started_at).toISOString()}
          </div>
          <div>
            <span className="opacity-70">finalised:</span>{' '}
            {new Date(trace.finalised_at).toISOString()}
          </div>
          {trace.user_id ? (
            <div>
              <span className="opacity-70">userId:</span> {trace.user_id}
            </div>
          ) : null}
          {trace.request_id ? (
            <div>
              <span className="opacity-70">requestId:</span> {trace.request_id}
            </div>
          ) : null}
          {trace.parent_trace_id ? (
            <div>
              <span className="opacity-70">parent:</span>{' '}
              <Link
                href={`/decision-trace/${encodeURIComponent(trace.parent_trace_id)}`}
                className="underline hover:opacity-100"
              >
                {trace.parent_trace_id}
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-6" aria-label="Inputs the decision saw">
        <h2 className="text-sm font-medium text-neutral-300 mb-2">Inputs</h2>
        <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-4 overflow-x-auto text-neutral-200">
          {jsonBlock(trace.inputs ?? {})}
        </pre>
      </section>

      <section className="mb-6" aria-label="Branches considered (timeline)">
        <h2 className="text-sm font-medium text-neutral-300 mb-3">
          Branches considered ({branches.length})
        </h2>
        {branches.length === 0 ? (
          <div className="text-xs text-neutral-500 italic">
            No branches recorded — the decision bailed before considering alternatives.
          </div>
        ) : (
          <ol className="relative border-l border-neutral-800 ml-3">
            {branches.map((branch) => {
              const isChosen = branch.id === trace.chosen_branch_id;
              return (
                <li key={branch.id} className="mb-5 ml-5">
                  <span
                    className={`absolute -left-2 flex items-center justify-center w-4 h-4 rounded-full ${
                      isChosen
                        ? 'bg-emerald-500 ring-2 ring-emerald-900'
                        : 'bg-neutral-700'
                    }`}
                    aria-hidden
                  />
                  <div
                    className={`p-3 rounded border ${
                      isChosen
                        ? 'border-emerald-700 bg-emerald-950/40'
                        : 'border-neutral-800 bg-neutral-900/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs text-neutral-400 mr-2">
                          {branch.id}
                        </span>
                        <span className="text-sm text-neutral-100">
                          {branch.label}
                        </span>
                        {isChosen ? (
                          <span className="ml-2 text-xs px-2 py-0.5 bg-emerald-700 text-white rounded">
                            CHOSEN
                          </span>
                        ) : null}
                      </div>
                      {typeof branch.score === 'number' ? (
                        <span className="text-xs text-neutral-400 font-mono">
                          score={branch.score.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-neutral-300">
                      {branch.rationale}
                    </p>
                    {branch.metadata &&
                    Object.keys(branch.metadata).length > 0 ? (
                      <pre className="mt-2 text-xs text-neutral-400 bg-neutral-950 rounded p-2 overflow-x-auto">
                        {jsonBlock(branch.metadata)}
                      </pre>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {trace.chosen_rationale ? (
          <div className="mt-3 text-xs text-neutral-400">
            Rationale: {trace.chosen_rationale}
          </div>
        ) : null}
      </section>

      {trace.error ? (
        <section className="mb-6" aria-label="Error">
          <h2 className="text-sm font-medium text-rose-300 mb-2">Error</h2>
          <pre className="text-xs bg-rose-950/40 border border-rose-800 rounded p-4 text-rose-200 overflow-x-auto">
            {trace.error}
          </pre>
        </section>
      ) : null}

      <section className="mb-6" aria-label="Output">
        <h2 className="text-sm font-medium text-neutral-300 mb-2">Output</h2>
        <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-4 overflow-x-auto text-neutral-200">
          {jsonBlock(trace.output ?? null)}
        </pre>
      </section>

      {trace.attributes && Object.keys(trace.attributes).length > 0 ? (
        <section className="mb-6" aria-label="Attributes">
          <h2 className="text-sm font-medium text-neutral-300 mb-2">
            Attributes
          </h2>
          <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-4 overflow-x-auto text-neutral-200">
            {jsonBlock(trace.attributes)}
          </pre>
        </section>
      ) : null}
    </PageShell>
  );
}
