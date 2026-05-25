import type { ReactNode } from 'react';

interface PlaceholderCardProps {
  readonly title: string;
  readonly children?: ReactNode;
}

/**
 * Placeholder UI block used by every route stub.
 *
 * Gives each O-W-NN page real shape — a labeled surface where the
 * production component will land — without faking a screenshot the
 * product team has to retract later. The dashed border + neutral
 * tone signals "not yet wired" to any reviewer.
 */
export function PlaceholderCard({ title, children }: PlaceholderCardProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/30 p-6">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <div className="mt-3 text-sm text-neutral-300">{children}</div>
    </div>
  );
}
