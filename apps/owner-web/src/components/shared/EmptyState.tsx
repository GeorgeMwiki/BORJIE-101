/**
 * Empty-state placeholder.
 *
 * Rendered when a screen has no live data to show — typically because
 * the backing gateway endpoint is not yet wired or the session is
 * unauthenticated. Replaces what used to be a pre-rendered mock
 * dataset.
 *
 * LitFin-pattern shape:
 *   - Tinted-icon container (defaults to `Inbox`, lift via `icon` prop)
 *   - Display-medium title
 *   - Muted description, max 56ch
 *   - Optional mono hint chip below (for ops-facing "GET /api/..." breadcrumbs)
 *
 * Lives inside the cockpit's section cards, so the outer container is
 * intentionally borderless — the section card already supplies the
 * hairline.
 */
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  /** Optional ops-facing hint (mono, muted). Truncated to 96 chars. */
  readonly hint?: string;
  /** Override the default Inbox icon. */
  readonly icon?: ReactNode;
  /** Optional CTA rendered below the description. */
  readonly action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  hint,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center"
    >
      <div
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-signal-500"
      >
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="font-display text-base font-medium tracking-tight text-foreground">
        {title}
      </h3>
      <p className="max-w-prose-narrow text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {hint ? (
        <p className="mt-1 font-mono text-tiny uppercase tracking-eyebrow-wide text-muted-foreground/70">
          {hint.length > 96 ? `${hint.slice(0, 96)}…` : hint}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
