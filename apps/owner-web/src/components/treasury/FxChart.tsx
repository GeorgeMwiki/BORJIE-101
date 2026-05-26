'use client';

/**
 * FX & gold price chart. Renders an empty-state placeholder until the
 * gateway exposes `/api/v1/mining/cockpit/fx-history` (or similar).
 * The chart will mount as soon as a live tick stream is wired.
 */
export function FxChart() {
  return (
    <article className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Live FX & gold - 30 days
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">
        FX history not yet wired
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Wire `/api/v1/mining/cockpit/fx-history` and the TZS/USD and
        gold USD/oz lines will render here.
      </p>
    </article>
  );
}
