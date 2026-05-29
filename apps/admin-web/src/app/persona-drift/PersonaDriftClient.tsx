'use client';

/**
 * PersonaDriftClient — admin dashboard renderer (Phase D D7).
 *
 * Fetches `/api/v1/persona-drift/events` (DB scan of
 * `kernel_persona_drift_events`) every 60 s and renders:
 *
 *   - a table of the most recent breaches (timestamp, persona,
 *     severity, worst-dim, excerpt)
 *   - a bar chart of dim-breach counts over the last N days
 *
 * Production binds the endpoint to a router that paginates the table.
 * In the absence of a wired endpoint the client shows a friendly
 * "Awaiting first breach" empty state.
 */

import { useEffect, useMemo, useState } from 'react';

interface DriftEvent {
  readonly id: string;
  readonly personaId: string;
  readonly violationType: string;
  readonly excerpt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detectedAt: string;
  readonly worstDim?: string;
}

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly events: ReadonlyArray<DriftEvent>;
  readonly error: string | null;
  readonly fetchedAt: number | null;
}

const POLL_INTERVAL_MS = 60_000;

function endpoint(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  const trimmed = base ? base.replace(/\/$/, '') : '';
  return `${trimmed}/api/v1/persona-drift/events`;
}

export function PersonaDriftClient() {
  const [state, setState] = useState<FetchState>({
    status: 'idle',
    events: [],
    error: null,
    fetchedAt: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchEvents() {
      try {
        setState((s) => ({ ...s, status: 'loading' }));
        const res = await fetch(endpoint(), { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { data?: ReadonlyArray<DriftEvent> };
        if (cancelled) return;
        setState({
          status: 'ok',
          events: data.data ?? [],
          error: null,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    void fetchEvents();
    const id = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [reloadKey]);

  const chartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of state.events) {
      const day = e.detectedAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count }));
  }, [state.events]);

  if (state.status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <div>
          <span className="font-medium">Could not load persona-drift events.</span>
          <span className="ml-1 text-muted-foreground">{state.error}</span>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="self-start rounded-md border border-destructive/40 bg-surface px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state.status === 'loading' && state.events.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading persona-drift events"
        className="flex flex-col gap-6"
      >
        <section>
          <div className="mb-2 h-4 w-44 animate-pulse rounded bg-surface-raised" />
          <div className="h-32 animate-pulse rounded-md border border-border bg-surface" />
        </section>
        <section>
          <div className="mb-2 h-4 w-32 animate-pulse rounded bg-surface-raised" />
          <div className="h-40 animate-pulse rounded-md border border-border bg-surface" />
        </section>
      </div>
    );
  }

  if (state.status === 'ok' && state.events.length === 0) {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-4 text-sm text-success">
        Awaiting first breach. The persona-drift cron emits one event per
        (tenant, persona, day) when the 24-dim probe exceeds threshold.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Breach counts by day
        </h2>
        <div className="flex h-32 items-end gap-2 rounded-md border border-border bg-surface p-3">
          {chartData.map((bar) => {
            const maxCount = Math.max(...chartData.map((d) => d.count), 1);
            const heightPct = (bar.count / maxCount) * 100;
            return (
              <div
                key={bar.day}
                className="flex flex-col items-center gap-1"
                title={`${bar.day}: ${bar.count}`}
              >
                <div
                  className="w-6 rounded-t-sm bg-indigo-500"
                  style={{ height: `${heightPct}%` }}
                />
                <span className="text-tiny text-muted-foreground">
                  {bar.day.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Recent breaches
        </h2>
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-raised text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Persona</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Worst dim</th>
                <th className="px-3 py-2">Excerpt</th>
              </tr>
            </thead>
            <tbody>
              {state.events.slice(0, 50).map((e) => (
                <tr key={e.id} className="border-t border-border/40">
                  <td className="px-3 py-2 text-muted-foreground">{e.detectedAt}</td>
                  <td className="px-3 py-2 text-foreground">{e.personaId}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        e.severity === 'high'
                          ? 'rounded bg-destructive/15 px-2 py-0.5 text-destructive'
                          : e.severity === 'medium'
                            ? 'rounded bg-warning/15 px-2 py-0.5 text-warning'
                            : 'rounded bg-surface-raised px-2 py-0.5 text-muted-foreground'
                      }
                    >
                      {e.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {e.worstDim ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-foreground">{e.excerpt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
