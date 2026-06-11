import type { ReactElement } from 'react';

/**
 * `loading.tsx` for the owner dashboard.
 *
 * The dashboard has a distinct rhythm from the `(routes)` surfaces —
 * a tall greeting hero, the daily-brief card, a KPI strip, the
 * Owner-OS tab strip, then the live BFF surface. This skeleton mirrors
 * that vertical order with `space-y-10` so the page paints a stable
 * frame the instant the owner lands, with no layout shift as each
 * region streams in.
 *
 * Tokens only; `aria-hidden` so assistive tech skips the placeholder.
 */
export default function DashboardLoading(): ReactElement {
  return (
    <div className="space-y-10" aria-hidden="true" data-testid="dashboard-skeleton">
      {/* Greeting hero */}
      <header>
        <div className="h-3 w-32 animate-pulse rounded-full bg-muted/40" />
        <div className="mt-4 h-12 w-3/4 animate-pulse rounded-lg bg-muted/40" />
        <div className="mt-3 h-3 w-1/2 animate-pulse rounded-full bg-muted/30" />
        <div className="mt-6 flex flex-wrap gap-3">
          <div className="h-9 w-32 animate-pulse rounded-full bg-muted/30" />
          <div className="h-9 w-32 animate-pulse rounded-full bg-muted/20" />
          <div className="h-9 w-36 animate-pulse rounded-full bg-muted/20" />
        </div>
      </header>

      {/* Daily-brief card */}
      <div className="h-44 animate-pulse rounded-xl border border-border bg-muted/30" />

      {/* KPI strip — five tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-border bg-muted/30"
          />
        ))}
      </div>

      {/* Owner-OS tab strip */}
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted/30" />
        <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/20" />
      </div>

      {/* Live BFF surface */}
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted/30" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/20" />
      </div>
    </div>
  );
}
