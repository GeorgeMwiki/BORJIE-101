import type { ReactElement } from 'react';
import { Skeleton } from '@borjie/design-system';

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
 * Every shimmer block delegates to the DS `Skeleton` primitive (the
 * pulse animation, radius, and `bg-muted` token come from ONE source) —
 * no raw `animate-pulse bg-muted/NN` literals. `aria-hidden` so
 * assistive tech skips the placeholder.
 */
export default function DashboardLoading(): ReactElement {
  return (
    <div className="space-y-10" aria-hidden="true" data-testid="dashboard-skeleton">
      {/* Greeting hero */}
      <header>
        <Skeleton className="h-3 w-32 rounded-full" />
        <Skeleton className="mt-4 h-12 w-3/4 rounded-lg" />
        <Skeleton className="mt-3 h-3 w-1/2 rounded-full" />
        <div className="mt-6 flex flex-wrap gap-3">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
      </header>

      {/* Daily-brief card */}
      <Skeleton className="h-44 rounded-xl border border-border" />

      {/* KPI strip — five tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl border border-border" />
        ))}
      </div>

      {/* Owner-OS tab strip */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="h-48 rounded-xl border border-border" />
      </div>

      {/* Live BFF surface */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="h-64 rounded-xl border border-border" />
      </div>
    </div>
  );
}
