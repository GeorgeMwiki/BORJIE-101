'use client';

import type { ReactElement } from 'react';

/**
 * Lightweight placeholder shown while a lazy panel surface chunk loads.
 * Panels render their (eager) PanelHero immediately and stream the heavy
 * domain surface in behind this skeleton, so opening a tab feels instant
 * and the surface's JS stays out of the initial portal bundle.
 */
export function SurfaceSkeleton(): ReactElement {
  return (
    <div
      className="space-y-3"
      aria-hidden="true"
      data-testid="panel-surface-skeleton"
    >
      <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
      <div className="h-40 animate-pulse rounded-xl bg-muted/30" />
    </div>
  );
}
