'use client';

import Link from 'next/link';
import { useDashboardKillswitch } from '@/lib/internal/queries/dashboard';

const LEVEL_PILL: Record<string, string> = {
  live: 'border-success/40 bg-success-subtle/20 text-success',
  degraded: 'border-warning/40 bg-warning-subtle/20 text-warning',
  halt: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/**
 * Kill-switch status panel — top-right.
 *
 * Reads `/mining/internal/killswitch` for the current scope/level
 * matrix. Surfaces counts of halt / degraded / live scopes and the
 * three most recent transitions for context. Two-operator confirmation
 * lives at the kill-switch screen — this is a status mirror only.
 */
export function KillSwitchStatusPanel(): JSX.Element {
  const query = useDashboardKillswitch();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-killswitch-skeleton"
      />
    );
  }

  if (query.error || !query.data) {
    return (
      <article
        className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
        data-testid="admin-dashboard-killswitch-error"
      >
        <h2 className="text-caption uppercase tracking-widest text-warning">
          Kill-switch status unavailable
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {query.error instanceof Error
            ? query.error.message
            : 'Endpoint unreachable'}
        </p>
      </article>
    );
  }

  const { rows, halt, degraded, live } = query.data;
  const danger = halt > 0;

  return (
    <article
      className={`rounded-lg border p-5 ${
        danger
          ? 'border-destructive/40 bg-destructive/5'
          : degraded > 0
            ? 'border-warning/40 bg-warning-subtle/5'
            : 'border-border bg-surface'
      }`}
      data-testid="admin-dashboard-killswitch"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Kill-switch
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {halt + degraded}
          </p>
          <p className="text-xs text-neutral-500">non-live scopes</p>
        </div>
        <Link
          href="/internal/killswitch"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          Manage →
        </Link>
      </header>
      <div className="mb-3 flex gap-2 text-xs">
        <span className={`pill ${LEVEL_PILL.halt}`}>{halt} halt</span>
        <span className={`pill ${LEVEL_PILL.degraded}`}>{degraded} degraded</span>
        <span className={`pill ${LEVEL_PILL.live}`}>{live} live</span>
      </div>
      {rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="admin-dashboard-killswitch-empty"
        >
          No kill-switch state rows reported.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.slice(0, 3).map((row, i) => (
            <li
              key={`${row.scope}-${i}`}
              className="flex items-baseline justify-between gap-3"
              data-testid="admin-dashboard-killswitch-row"
            >
              <span className="truncate text-foreground">{row.scope}</span>
              <span
                className={`pill ${LEVEL_PILL[row.level] ?? 'border-border text-neutral-400'}`}
              >
                {row.level}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
