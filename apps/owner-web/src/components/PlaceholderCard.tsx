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
 * product team has to retract later.
 *
 * LitFin-pattern: hairline border (no dashed border — reads as broken
 * not in-progress), small mono kicker, body copy in muted-foreground.
 * The card stays inside the cockpit's section rhythm so an empty page
 * still feels like a Borjie page, not a blank.
 */
export function PlaceholderCard({ title, children }: PlaceholderCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-6 transition-colors hover:border-border-strong">
      <p className="font-mono text-badge font-semibold uppercase tracking-eyebrow-wide text-signal-500">
        {title}
      </p>
      {children ? (
        <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
