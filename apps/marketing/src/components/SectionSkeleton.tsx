/**
 * SectionSkeleton — minimal animated placeholder used as a Suspense
 * fallback for marketing sections that ship via `next/dynamic` or
 * similar code-splitting. Mirrors LitFin's SectionSkeleton: a single
 * pulsing surface tile with reserved height so layout shift stays at
 * zero before the lazy chunk arrives.
 *
 * Pair this with `LazyVisible` for IntersectionObserver-gated mounting:
 * `LazyVisible` reserves the slot, and once the user scrolls within
 * range, the lazy chunk streams in. If you wrap the lazy import in a
 * `<Suspense>`, this skeleton acts as the streaming fallback.
 */
export interface SectionSkeletonProps {
  readonly minHeight?: number;
  readonly cards?: number;
}

export function SectionSkeleton({
  minHeight = 480,
  cards = 3,
}: SectionSkeletonProps) {
  return (
    <div
      className="mx-auto my-16 max-w-7xl px-5"
      aria-hidden="true"
      style={{ minHeight }}
    >
      <div className="animate-pulse rounded-lg bg-surface" style={{ minHeight: minHeight - 80 }}>
        <div className="grid h-full gap-3 p-6" style={{ gridTemplateColumns: `repeat(${Math.min(cards, 4)}, minmax(0, 1fr))` }}>
          {Array.from({ length: cards }).map((_, i) => (
            <div
              key={i}
              className="rounded-md bg-surface-raised"
              style={{ minHeight: minHeight - 140 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
