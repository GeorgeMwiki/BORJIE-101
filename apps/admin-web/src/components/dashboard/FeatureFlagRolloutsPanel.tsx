'use client';

import Link from 'next/link';
import { useDashboardFeatureFlags } from '@/lib/internal/queries/dashboard';

/**
 * Feature-flag rollouts panel — middle-centre.
 *
 * Reads `/api/v1/feature-flags`. When the service is unwired the
 * gateway responds 503/NOT_IMPLEMENTED; this panel surfaces that as a
 * clear env-missing copy so operators are not misled into thinking
 * the flag table is empty.
 */
export function FeatureFlagRolloutsPanel(): JSX.Element {
  const query = useDashboardFeatureFlags();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-flags-skeleton"
      />
    );
  }

  const data = query.data;
  if (!data || data.state === 'failed') {
    return (
      <article
        className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
        data-testid="admin-dashboard-flags-error"
      >
        <h2 className="text-caption uppercase tracking-widest text-warning">
          Feature flags unavailable
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {data?.message ?? 'Endpoint unreachable'}
        </p>
      </article>
    );
  }

  if (data.state === 'unconfigured') {
    return (
      <article
        className="rounded-2xl border border-border bg-surface/40 p-5"
        data-testid="admin-dashboard-flags-unconfigured"
      >
        <h2 className="font-mono text-mini font-semibold uppercase tracking-eyebrow text-neutral-500">
          Feature flags
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {data.message ??
            'FeatureFlags service not yet wired into the api-gateway.'}
        </p>
        <p className="mt-2 font-mono text-tiny uppercase tracking-eyebrow text-muted-foreground/70">
          NEXT_PUBLIC_API_GATEWAY_URL · service slot pending
        </p>
      </article>
    );
  }

  const enabledCount = data.rows.filter((r) => r.enabled).length;

  return (
    <article
      className="rounded-lg border border-border bg-surface p-5"
      data-testid="admin-dashboard-flags"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Feature flags
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {enabledCount}
          </p>
          <p className="text-xs text-neutral-500">
            enabled of {data.rows.length}
          </p>
        </div>
        <Link
          href="/feature-flags"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          Manage →
        </Link>
      </header>
      {data.rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="admin-dashboard-flags-empty"
        >
          No flags registered.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.rows.slice(0, 5).map((row) => (
            <li
              key={row.key}
              className="flex items-baseline justify-between gap-3"
              data-testid="admin-dashboard-flags-row"
            >
              <span className="truncate text-foreground">{row.key}</span>
              <span
                className={`pill ${
                  row.enabled
                    ? 'border-success/40 bg-success-subtle/20 text-success'
                    : 'border-border text-neutral-400'
                }`}
              >
                {row.enabled ? 'on' : 'off'}
                {row.rolloutPct !== null ? ` · ${row.rolloutPct}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
