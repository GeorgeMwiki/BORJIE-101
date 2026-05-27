'use client';

import { useDashboardPilotErrors } from '@/lib/internal/queries/dashboard';

/**
 * Pilot errors panel — top-centre.
 *
 * Reads from the gateway's in-memory pilot-error ring buffer
 * (`/api/v1/pilot/errors`). Displays the latest 10 events with cohort
 * tags. 401/403 collapses to an env-missing copy because pilot errors
 * are admin-tier only.
 */
export function PilotErrorsPanel(): JSX.Element {
  const query = useDashboardPilotErrors();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-pilot-errors-skeleton"
      />
    );
  }

  const data = query.data;
  if (!data || data.state === 'failed') {
    return (
      <PanelError
        message={
          data?.message ??
          (query.error instanceof Error
            ? query.error.message
            : 'Pilot error stream unavailable')
        }
      />
    );
  }

  if (data.state === 'unauthorized') {
    return (
      <article
        className="rounded-lg border border-border bg-surface p-5"
        data-testid="admin-dashboard-pilot-errors-unauth"
      >
        <header className="mb-3">
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Pilot errors
          </h2>
        </header>
        <p className="text-sm text-neutral-400">
          Requires admin-tier sign-in. Reauthenticate from the HQ home.
        </p>
      </article>
    );
  }

  return (
    <article
      className="rounded-lg border border-border bg-surface p-5"
      data-testid="admin-dashboard-pilot-errors"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Pilot errors
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {data.rows.length}
          </p>
          <p className="text-xs text-neutral-500">last 10 captured</p>
        </div>
      </header>
      {data.rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="admin-dashboard-pilot-errors-empty"
        >
          No pilot errors in the current window.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.rows.slice(0, 5).map((row) => (
            <li
              key={row.id}
              className="border-l-2 border-warning/40 pl-2"
              data-testid="admin-dashboard-pilot-errors-row"
            >
              <div className="truncate text-foreground">{row.message}</div>
              <div className="text-xs text-neutral-500">
                {row.cohort} ·{' '}
                {new Date(row.capturedAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PanelError({ message }: { readonly message: string }) {
  return (
    <article
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
      data-testid="admin-dashboard-pilot-errors-error"
    >
      <h2 className="text-caption uppercase tracking-widest text-warning">
        Pilot errors unavailable
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
    </article>
  );
}
