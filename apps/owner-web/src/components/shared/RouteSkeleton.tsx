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
 * Tokens only (no hex) — `bg-muted/*` + `animate-pulse` match the
 * existing `SurfaceSkeleton` / admin fallback look. `aria-hidden` so
 * screen readers skip the placeholder; the live region announces once
 * the real content lands.
 */
import type { ReactElement } from 'react';

export function RouteSkeleton(): ReactElement {
  return (
    <div
      className="space-y-8 px-8 py-8"
      aria-hidden="true"
      data-testid="route-skeleton"
    >
      {/* PageHero-shaped header band */}
      <header className="border-b border-border pb-6">
        <div className="h-3 w-40 animate-pulse rounded-full bg-muted/40" />
        <div className="mt-4 h-9 w-2/3 animate-pulse rounded-lg bg-muted/40" />
        <div className="mt-3 h-3 w-1/3 animate-pulse rounded-full bg-muted/30" />
        <div className="mt-5 flex flex-wrap gap-3">
          <div className="h-8 w-36 animate-pulse rounded-full bg-muted/30" />
          <div className="h-8 w-36 animate-pulse rounded-full bg-muted/20" />
        </div>
      </header>

      {/* Reserved content column — two stacked panels matching the
          card-grid rhythm so the box sizes are held while data streams. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-border bg-muted/30"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/20" />
    </div>
  );
}
