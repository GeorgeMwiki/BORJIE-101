'use client';

import {
  useActivationFunnelQuery,
  useCohortsQuery,
  type FunnelStep,
  type Cohort,
} from '@/lib/internal/queries/analytics';
import { DataSourceBadge } from '../DataSourceBadge';

/**
 * Live HQ product analytics.
 *
 * Binds to:
 *   GET /api/v1/mining/internal/analytics/funnel  — distinct tenants per
 *       ordered activation milestone (within a 90-day window).
 *   GET /api/v1/mining/internal/analytics/cohorts — monthly signup cohorts
 *       + an activation retention proxy.
 *
 * Every number is computed from the real append-only `activation_events`
 * log — no fixtures. Empty until milestone events accrue.
 */
export function AnalyticsView(): JSX.Element {
  const funnel = useActivationFunnelQuery(90);
  const cohorts = useCohortsQuery();

  return (
    <div className="space-y-6">
      <FunnelSection
        isPending={funnel.isPending}
        error={funnel.isError ? funnel.error.message : null}
        steps={funnel.data?.steps ?? []}
        windowDays={funnel.data?.windowDays ?? 90}
      />
      <CohortSection
        isPending={cohorts.isPending}
        error={cohorts.isError ? cohorts.error.message : null}
        cohorts={cohorts.data?.cohorts ?? []}
      />
      <DataSourceBadge source="live" />
    </div>
  );
}

function FunnelSection({
  isPending,
  error,
  steps,
  windowDays,
}: {
  readonly isPending: boolean;
  readonly error: string | null;
  readonly steps: ReadonlyArray<FunnelStep>;
  readonly windowDays: number;
}): JSX.Element {
  const max = steps[0]?.count ?? 0;
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Activation funnel ({windowDays}d)
      </h3>
      {isPending ? (
        <p className="text-sm text-neutral-500">Loading funnel…</p>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : steps.every((s) => s.count === 0) ? (
        <p className="text-sm text-neutral-500">
          No activation events recorded yet in this window.
        </p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step) => {
            const pct = max > 0 ? Math.round((step.count / max) * 100) : 0;
            return (
              <li key={step.eventType} className="flex items-center gap-4">
                <span className="w-48 shrink-0 text-sm text-neutral-300">
                  {step.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full bg-signal-500"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct} percent`}
                  />
                </div>
                <span className="w-12 text-right text-sm tabular-nums text-neutral-300">
                  {step.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CohortSection({
  isPending,
  error,
  cohorts,
}: {
  readonly isPending: boolean;
  readonly error: string | null;
  readonly cohorts: ReadonlyArray<Cohort>;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Signup cohorts &amp; activation
      </h3>
      {isPending ? (
        <p className="text-sm text-neutral-500">Loading cohorts…</p>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : cohorts.length === 0 ? (
        <p className="text-sm text-neutral-500">No signup cohorts yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="py-2 font-medium">Cohort</th>
              <th className="py-2 text-right font-medium">Signed up</th>
              <th className="py-2 text-right font-medium">Activated</th>
              <th className="py-2 text-right font-medium">Activation</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((row) => (
              <tr key={row.cohort} className="border-t border-border">
                <td className="py-2 text-foreground">{row.cohort}</td>
                <td className="py-2 text-right tabular-nums text-neutral-300">
                  {row.signedUp}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-300">
                  {row.activated}
                </td>
                <td className="py-2 text-right tabular-nums text-signal-500">
                  {row.activationPct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
