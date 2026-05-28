import type { ReactNode } from 'react';
import { Wrench } from 'lucide-react';

interface StubCardProps {
  readonly title: string;
  readonly description: string;
  /** Optional mono hint (e.g. the pending api path). */
  readonly hint?: string;
  /** Override the default Wrench icon. */
  readonly icon?: ReactNode;
}

/**
 * Internal-page stub card.
 *
 * Renders a Borjie-HQ surface that is awaiting wiring. LitFin-pattern
 * shape — hairline border (not dashed), tinted icon plate, display
 * heading, muted description, optional mono hint. Replaces ad-hoc
 * `border-dashed` blocks scattered across internal stubs so every
 * not-yet-wired screen reads the same way.
 */
export function StubCard({ title, description, hint, icon }: StubCardProps) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-signal-500"
      >
        {icon ?? <Wrench className="h-5 w-5" />}
      </div>
      <h3 className="font-display text-base font-medium tracking-tight text-foreground">
        {title}
      </h3>
      <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {hint ? (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
