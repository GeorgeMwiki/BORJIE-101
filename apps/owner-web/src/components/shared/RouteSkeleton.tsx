/**
 * RouteSkeleton — the instant-paint placeholder Next.js renders from a
 * route segment's `loading.tsx` while the server component for that
 * segment streams in.
 *
 * Shape mirrors the real owner-web route rhythm so there is zero layout
 * shift (CLS) when the content swaps in:
 *   1. A `PageHero`-shaped header band (eyebrow + headline + gloss),
 *      closed by the same `border-b border-border pb-6` hairline.
 *   2. A reserved content column (cards / panels) using the same
 *      `space-y-8` spacing the routes use.
 *
 * CONVERGED (DS foundation wave): every shimmer block now delegates to
 * the shared `Skeleton` primitive from `@borjie/design-system` so the
 * pulse animation, radius, and `bg-muted` token come from ONE source of
 * truth — no more raw `animate-pulse bg-muted/NN` literals. The wrapper
 * keeps its `(): ReactElement` signature and the
 * `data-testid="route-skeleton"` hook verbatim so `loading.tsx` and any
 * test importer compile unchanged. `aria-hidden` stays on the outer box
 * so screen readers skip the placeholder; DS `Skeleton` carries its own
 * `role="status"` but the hidden ancestor suppresses it here.
 */
import type { ReactElement } from 'react';
import { Skeleton } from '@borjie/design-system';

export function RouteSkeleton(): ReactElement {
  return (
    <div
      className="space-y-8 px-8 py-8"
      aria-hidden="true"
      data-testid="route-skeleton"
    >
      {/* PageHero-shaped header band */}
      <header className="border-b border-border pb-6">
        <Skeleton className="h-3 w-40 rounded-full" />
        <Skeleton className="mt-4 h-9 w-2/3 rounded-lg" />
        <Skeleton className="mt-3 h-3 w-1/3 rounded-full" />
        <div className="mt-5 flex flex-wrap gap-3">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-8 w-36 rounded-full" />
        </div>
      </header>

      {/* Reserved content column — three stacked tiles matching the
          card-grid rhythm so the box sizes are held while data streams. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl border border-border" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl border border-border" />
    </div>
  );
}
