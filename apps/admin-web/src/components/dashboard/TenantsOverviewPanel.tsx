'use client';

import Link from 'next/link';
import { useDashboardTenants } from '@/lib/internal/queries/dashboard';

/**
 * Tenants overview — top-left panel.
 *
 * Total tenants + the five most recent provision rows. Links to the
 * internal tenant directory for deep operations (suspend, plan, etc.).
 */
export function TenantsOverviewPanel(): JSX.Element {
  const query = useDashboardTenants();

  if (query.isLoading) {
    return <PanelSkeleton testId="admin-dashboard-tenants" />;
  }

  if (query.error || !query.data) {
    return (
      <PanelError
        title="Tenants"
        message={
          query.error instanceof Error
            ? query.error.message
            : 'Unable to load tenants'
        }
        testId="admin-dashboard-tenants"
      />
    );
  }

  const { total, recent } = query.data;

  return (
    <article
      className="rounded-lg border border-border bg-surface p-5"
      data-testid="admin-dashboard-tenants"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Tenants
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {total}
          </p>
          <p className="text-xs text-neutral-500">total provisioned</p>
        </div>
        <Link
          href="/internal/tenants"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          Directory →
        </Link>
      </header>
      {recent.length === 0 ? (
        <p
          className="mt-2 text-sm text-neutral-400"
          data-testid="admin-dashboard-tenants-empty"
        >
          No tenants yet. Provision one from the directory.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {recent.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-3"
              data-testid="admin-dashboard-tenants-row"
            >
              <span className="truncate text-foreground">{row.name}</span>
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                {row.plan} · {row.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

interface PanelSkeletonProps {
  readonly testId: string;
}

function PanelSkeleton({ testId }: PanelSkeletonProps): JSX.Element {
  return (
    <div
      className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
      data-testid={`${testId}-skeleton`}
    />
  );
}

interface PanelErrorProps {
  readonly title: string;
  readonly message: string;
  readonly testId: string;
}

function PanelError({
  title,
  message,
  testId,
}: PanelErrorProps): JSX.Element {
  return (
    <article
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
      data-testid={`${testId}-error`}
    >
      <h2 className="text-caption uppercase tracking-widest text-warning">
        {title} unavailable
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
    </article>
  );
}
