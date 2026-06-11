/**
 * AdminRouteSkeleton — the instant-paint placeholder Next.js renders
 * from an admin route segment's `loading.tsx` while that segment's
 * server component streams in.
 *
 * Shape mirrors the admin surface rhythm (header band closed by the
 * same `border-b border-border pb-6` hairline the dashboard uses, then
 * a 4-up KPI strip and a panel grid) so the content swap causes zero
 * layout shift. Tokens only — `bg-surface/40` + `animate-pulse` match
 * the existing admin dashboard fallbacks.
 */
import type { ReactElement } from 'react';

export function AdminRouteSkeleton(): ReactElement {
  return (
    <div className="space-y-8" aria-hidden="true" data-testid="admin-route-skeleton">
      {/* Header band */}
      <header className="border-b border-border pb-6">
        <div className="h-3 w-40 animate-pulse rounded-full bg-surface/60" />
        <div className="mt-4 h-9 w-1/2 animate-pulse rounded-lg bg-surface/50" />
        <div className="mt-3 h-3 w-2/3 animate-pulse rounded-full bg-surface/40" />
      </header>

      {/* KPI strip — four cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-border bg-surface/40"
          />
        ))}
      </div>

      {/* Panel grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
          />
        ))}
      </div>
    </div>
  );
}
