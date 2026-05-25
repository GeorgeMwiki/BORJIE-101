import type { ReactNode } from 'react';

interface SectionCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Reusable section card with a token-driven header strip.
 *
 * Replaces the `PlaceholderCard` shape for screens that now hold real
 * content. Title + optional subtitle on the left, action slot on the
 * right (refresh, generate, export). Keeps every section visually
 * aligned with the cockpit cards on the home page.
 */
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface shadow-sm ${className ?? ''}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-0.5 text-[11px] text-neutral-500">{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
