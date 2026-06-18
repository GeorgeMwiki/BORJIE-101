'use client';

import { Button } from '@borjie/design-system';
import { useTenantCurrent } from '@/lib/queries/tenant';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * Plan + billing panel — wired to the LIVE current-tenant read
 * (GET /api/v1/tenants/current via useTenantCurrent). Shows the owner's
 * subscription plan, status, and seat/unit limits. Honest states: a
 * loading skeleton, a real error message, and "—" placeholders for any
 * field the gateway omits (never fabricated).
 *
 * Scope note: detailed RBAC role assignment + autonomy-policy controls
 * are separate, not-yet-built owner endpoints — see the gateway-wave list.
 */
function valueOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function PlanBillingPanel() {
  const { data, isLoading, isError, error, refetch } = useTenantCurrent();

  if (isLoading) {
    return (
      <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }
  if (isError) {
    return (
      <EmptyState
        title="Could not load plan & billing"
        description={
          error instanceof Error ? error.message : 'Please try again.'
        }
        hint="GET /api/v1/tenants/current"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const sub = data?.subscription;
  const rows: ReadonlyArray<{ readonly label: string; readonly value: string }> =
    [
      { label: 'Plan', value: valueOrDash(sub?.plan) },
      { label: 'Status', value: valueOrDash(sub?.status ?? data?.status) },
      { label: 'Max units', value: valueOrDash(sub?.maxUnits) },
      { label: 'Max users', value: valueOrDash(sub?.maxUsers) },
      { label: 'Billing contact', value: valueOrDash(data?.contactEmail) },
    ];

  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg text-foreground">Plan & billing</h2>
        <span className="text-xs text-neutral-500">{valueOrDash(data?.name)}</span>
      </div>
      <p className="mt-0.5 text-xs italic text-neutral-500">Mpango na malipo</p>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between border-b border-border/60 py-1.5"
          >
            <dt className="text-sm text-neutral-400">{row.label}</dt>
            <dd className="text-sm font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-neutral-500">
        RBAC role assignment and autonomy-policy controls are coming in a
        later wave.
      </p>
    </section>
  );
}
