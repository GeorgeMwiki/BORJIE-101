/**
 * `<SectionSkeleton>` — default Suspense fallback while a lazy
 * section's component module is being downloaded. Intentionally
 * lightweight; portals can override with their own design-system
 * skeleton if they want a richer treatment.
 *
 * Mobile-first: full-width on `sm`, capped to `max-w-3xl` on `md+`.
 * Animation uses `animate-pulse` (a Tailwind utility every BORJIE
 * portal already loads) rather than a custom keyframe, so this
 * package adds zero CSS bytes to the host bundle.
 */

import type { ReactElement } from 'react';

export interface SectionSkeletonProps {
  /** Label echoed inside the skeleton — purely for a11y/devtools. */
  readonly sectionLabel?: string;
  /** Optional className for layout overrides from the host portal. */
  readonly className?: string;
}

export function SectionSkeleton({
  sectionLabel,
  className,
}: SectionSkeletonProps): ReactElement {
  const root = ['dynamic-section-skeleton', 'w-full', 'max-w-3xl', 'mx-auto', 'p-4', 'space-y-3', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      data-testid="dynamic-section-skeleton"
      role="status"
      aria-label={sectionLabel ? `Loading ${sectionLabel}` : 'Loading section'}
      aria-live="polite"
      className={root}
    >
      <div className="animate-pulse h-6 w-1/3 rounded bg-slate-200" />
      <div className="animate-pulse h-32 w-full rounded bg-slate-200" />
      <div className="animate-pulse h-6 w-2/3 rounded bg-slate-200" />
      <span className="sr-only">
        {sectionLabel ? `Loading ${sectionLabel} section` : 'Loading section content'}
      </span>
    </div>
  );
}
