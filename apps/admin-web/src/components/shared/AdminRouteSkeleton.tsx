/**
 * AdminRouteSkeleton — the instant-paint placeholder Next.js renders
 * from an admin route segment's `loading.tsx` while that segment's
 * server component streams in.
 *
 * Built on the shared design-system `Skeleton` primitive so every route
 * shell inherits ONE pulse animation, ONE radius scale, and ONE muted
 * fill (`bg-muted` via the DS token) — no per-app `bg-surface/40` drift.
 * The OUTER layout (header band closed by the `border-b border-border
 * pb-6` hairline the dashboard uses, then a 4-up KPI strip and a 6-card
 * panel grid) is preserved verbatim so the content swap causes zero
 * layout shift. The DS `Skeleton` already carries `role="status"` +
 * `aria-label`, so the wrapper stays `aria-hidden`.
 */
import type { ReactElement } from 'react';
import { Skeleton } from '@borjie/design-system';

export function AdminRouteSkeleton(): ReactElement {
  return (
    <div className="space-y-8" aria-hidden="true" data-testid="admin-route-skeleton">
      {/* Header band */}
      <header className="border-b border-border pb-6">
        <Skeleton className="h-3 w-40 rounded-full" />
        <Skeleton className="mt-4 h-9 w-1/2 rounded-lg" />
        <Skeleton className="mt-3 h-3 w-2/3 rounded-full" />
      </header>

      {/* KPI strip — four cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg border border-border" />
        ))}
      </div>

      {/* Panel grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-lg border border-border" />
        ))}
      </div>
    </div>
  );
}
