/**
 * Empty-state placeholder (CONVERGED onto the DS primitive).
 *
 * Rendered when a screen has no live data to show — typically because
 * the backing gateway endpoint is not yet wired or the session is
 * unauthenticated. Replaces what used to be a pre-rendered mock
 * dataset.
 *
 * This fork is now a THIN WRAPPER around `EmptyState` from
 * `@borjie/design-system`. The DS primitive owns the structural shell
 * (role="status", centred column, title + description + action layout,
 * `border-border` token). This wrapper preserves owner-web's two
 * extensions verbatim so all existing importers keep compiling:
 *   - the tinted-icon container (signal-gold ring, defaults to `Inbox`)
 *     passed into the DS `icon` slot pre-wrapped, and
 *   - the optional ops-facing mono `hint` chip, folded under the body
 *     through the DS `action` slot.
 *
 * Public API ({ title, description, hint?, icon?, action? }) is
 * UNCHANGED — do not alter the call signature.
 */
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { EmptyState as DSEmptyState } from '@borjie/design-system';

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
  // Preserve owner-web's tinted-icon container by pre-wrapping the glyph
  // before handing it to the DS `icon` slot.
  const iconNode = (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-signal-500">
      {icon ?? <Inbox className="h-6 w-6" />}
    </div>
  );

  // Fold the optional hint chip + CTA into the single DS `action` slot so
  // both render below the description in the DS layout.
  const trailing =
    hint || action ? (
      <div className="flex flex-col items-center gap-2">
        {hint ? (
          <p className="font-mono text-tiny uppercase tracking-eyebrow-wide text-muted-foreground/70">
            {hint.length > 96 ? `${hint.slice(0, 96)}…` : hint}
          </p>
        ) : null}
        {action ?? null}
      </div>
    ) : undefined;

  return (
    <DSEmptyState
      className="h-full gap-3 rounded-2xl bg-surface/40 px-6 py-12"
      icon={iconNode}
      title={title}
      // Forward the (already single-locale) title as the a11y label so the
      // status region speaks the caller's active language: no English
      // "Empty state:" prefix glued onto a Swahili title (zero-mix canon).
      // Passed as the native aria-label attribute (spread onto the status
      // region by the DS primitive), so it stays single-locale.
      aria-label={title}
      description={description}
      action={trailing}
    />
  );
}
